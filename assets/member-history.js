/* Read-only member attendance history. The existing owner-only RPC supplies the data. */
const $h = selector => document.querySelector(selector);
const money = value => Number(value || 0).toLocaleString('ko-KR') + '원';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
});
const dayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
});
const dayOf = value => dayFormatter.format(new Date(value));
const timeOf = value => dateFormatter.format(new Date(value));

/* A class can debit the last minutes of one pass and the first minutes of the
   next pass. Merge only small, close-together, same-day, different-pass debits.
   Separate 50- and 90-minute classes on the same day remain separate. */
export function groupMemberHistory(raw) {
  const ordered = [...raw].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const groups = [];
  for (const item of ordered) {
    const row = {
      ...item,
      minutes: Number(item.minutes || 0),
      consumed_won: Number(item.consumed_won || 0),
      parts: [item],
      passLabels: item.pass_label ? [item.pass_label] : []
    };
    const previous = groups[groups.length - 1];
    const canMerge = previous
      && previous.kind === 'attendance' && previous.status === 'attended'
      && row.kind === 'attendance' && row.status === 'attended'
      && previous.parts.length === 1
      && previous.pass_id !== row.pass_id
      && Math.min(previous.minutes, row.minutes) < 50
      && previous.minutes + row.minutes <= 90
      && dayOf(previous.at) === dayOf(row.at)
      && Math.abs(Date.parse(row.at) - Date.parse(previous.at)) <= 90 * 60000;
    if (canMerge) {
      previous.minutes += row.minutes;
      previous.consumed_won += row.consumed_won;
      previous.passLabels.push(...row.passLabels);
      previous.parts.push(item);
      previous.has_log = previous.has_log || row.has_log;
    } else {
      groups.push(row);
    }
  }
  return groups.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function summaryHtml(raw, groups) {
  const attended = groups.filter(x => x.kind === 'attendance' && x.status === 'attended');
  const noShow = groups.filter(x => x.kind === 'attendance' && x.status === 'no_show').length;
  const cancelled = groups.filter(x => x.kind === 'cancellation').length;
  const equivalent = attended.reduce((sum, x) =>
    sum + (x.minutes >= 140 ? 2.5 : x.minutes >= 90 ? 1.5 : 1), 0);
  const debits = raw.filter(x => x.kind === 'attendance');
  const minutes = debits.reduce((sum, x) => sum + Number(x.minutes || 0), 0);
  const won = debits.reduce((sum, x) => sum + Number(x.consumed_won || 0), 0);
  return [
    ['출석', attended.length + '건', '환산 ' + equivalent.toLocaleString('ko-KR') + '회'],
    ['노쇼 / 취소', noShow + '건 / ' + cancelled + '건', '취소는 수강권 차감 없음'],
    ['총 차감 시간', minutes.toLocaleString('ko-KR') + '분', '노쇼 차감 포함'],
    ['소진매출', money(won), '출석 및 노쇼 차감액']
  ].map(([label, value, detail]) =>
    '<div class="historyMetric"><small>' + label + '</small><strong>' + value +
    '</strong><span>' + detail + '</span></div>').join('');
}

function rowsHtml(groups) {
  if (!groups.length) return '<div class="empty">해당 기간의 출석·노쇼·취소 기록이 없어.</div>';
  return groups.map(row => {
    const cancelled = row.kind === 'cancellation';
    const noShow = row.status === 'no_show';
    const label = cancelled ? '취소' : noShow ? '노쇼' : '출석';
    const state = cancelled ? 'cancelled' : noShow ? 'no_show' : 'operating';
    const uniquePasses = [...new Set(row.passLabels)].filter(Boolean);
    const passInfo = cancelled
      ? '수강권 차감 없음'
      : uniquePasses.map(escapeHtml).join(' · ')
        + (row.parts.length > 1 ? ' · 수강권 분할 차감' : '')
        + ' · 소진액 ' + money(row.consumed_won);
    const note = row.note
      ? '<div class="historyNote">메모 · ' + escapeHtml(row.note) + '</div>' : '';
    return '<article class="historyItem">'
      + '<div class="historyItemTop"><strong>' + escapeHtml(timeOf(row.at)) + '</strong>'
      + '<span class="badge ' + state + '">' + label + '</span></div>'
      + '<div class="historyDuration">' + (row.minutes ? row.minutes + '분' : '시간 미기록')
      + (row.has_log ? ' <span class="historyLog">· 수업일지 있음</span>' : '') + '</div>'
      + '<div class="historyPass">' + passInfo + '</div>' + note + '</article>';
  }).join('');
}

export function setupMemberHistory(sb) {
  const modal = $h('#historyModal');
  const monthInput = $h('#historyMonth');
  const summary = $h('#historySummary');
  const list = $h('#historyRows');
  const message = $h('#historyMsg');
  let selectedMember = null;
  let requestNumber = 0;

  async function loadHistory() {
    if (!selectedMember || modal.classList.contains('hide')) return;
    const memberId = selectedMember.id;
    const currentRequest = ++requestNumber;
    const month = monthInput.value;
    let from = null, to = null;
    if (/^\d{4}-\d{2}$/.test(month)) {
      const [year, number] = month.split('-').map(Number);
      from = month + '-01';
      to = month + '-' + String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0');
    }
    message.textContent = '출석 이력을 불러오는 중…';
    list.innerHTML = '';
    summary.innerHTML = '';
    try {
      const { data, error } = await sb.rpc('member_attendance_history', {
        p_member_id: memberId, p_from: from, p_to: to
      });
      if (error) throw error;
      if (currentRequest !== requestNumber || modal.classList.contains('hide')
        || selectedMember?.id !== memberId) return;
      const raw = Array.isArray(data?.history) ? data.history : [];
      const groups = groupMemberHistory(raw);
      summary.innerHTML = summaryHtml(raw, groups);
      list.innerHTML = rowsHtml(groups);
      message.textContent = month ? month.replace('-', '년 ') + '월 기록' : '전체 기간 기록';
    } catch (error) {
      if (currentRequest !== requestNumber || modal.classList.contains('hide')) return;
      console.error('회원 출석 이력 조회 실패', error);
      message.textContent = '이력을 불러오지 못했어. 다시 조회해 줘.';
      list.innerHTML = '<div class="empty">조회 중 오류가 발생했어.</div>';
    }
  }

  function closeHistory() {
    ++requestNumber;
    selectedMember = null;
    modal.classList.add('hide');
  }

  $h('#closeHistory').addEventListener('click', closeHistory);
  $h('#historyAll').addEventListener('click', () => {
    monthInput.value = '';
    loadHistory();
  });
  monthInput.addEventListener('change', loadHistory);

  return member => {
    selectedMember = member;
    monthInput.value = '';
    $h('#historyTitle').textContent = member.name + '님 출석 이력';
    modal.classList.remove('hide');
    loadHistory();
  };
}
