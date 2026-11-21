import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient('https://bspzgodfoekodysjnsrn.supabase.co', 'sb_publishable_7JqWs7VbtXMBP_6e_NJnLw_b7yTnShf');
const $ = selector => document.querySelector(selector);
const dateKst = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const clockKst = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
const shortKst = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',month:'numeric',day:'numeric',weekday:'short'});
const won = value => Number(value || 0).toLocaleString('ko-KR') + '원';
const count = value => Number(value || 0).toLocaleString('ko-KR');
const dayOf = value => dateKst.format(new Date(value));
const monthStart = () => dayOf(new Date()).slice(0,7) + '-01';
let currentMonth = monthStart();
let lastMetrics = null;
let requestId = 0;

function make(tag, cls, content) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (content != null) el.textContent = String(content);
  return el;
}
function showAuth(message='') {
  ++requestId;
  $('#homeApp').classList.add('hide');
  $('#authPanel').classList.remove('hide');
  $('#homeAuthMsg').textContent = message;
}
function showApp() {
  $('#authPanel').classList.add('hide');
  $('#homeApp').classList.remove('hide');
}
async function isOwner() {
  const {data,error} = await sb.from('app_owners').select('user_id').maybeSingle();
  return !error && Boolean(data);
}
async function init() {
  try {
    const {data:{session},error} = await sb.auth.getSession();
    if (error || !session) return showAuth();
    if (!await isOwner()) return showAuth('관리자 권한을 확인할 수 없어. 관리자 계정으로 로그인해 줘.');
    showApp();
    await load();
  } catch (error) {
    console.error('홈 인증 확인 실패',error);
    showAuth('로그인 상태를 확인하지 못했어. 다시 로그인해 줘.');
  }
}
function renderGoal(m) {
  lastMetrics = m;
  const equivalent = Number(m.equivalent || 0);
  const goal = m.target == null ? null : Number(m.target);
  const month = Number(String(m.month).slice(5,7));
  $('#workloadTitle').textContent = month + '월 수업 목표';
  $('#workloadValue').textContent = count(equivalent);
  $('#goalValue').textContent = goal == null ? '/ 목표 미설정' : '/ ' + count(goal) + '회';
  const rate = goal ? equivalent / goal * 100 : 0;
  const percent = Math.max(0,Math.min(100,rate));
  $('#goalBar').style.width = percent + '%';
  $('#goalProgress').setAttribute('aria-valuenow',String(Math.round(percent)));
  $('#goalRate').textContent = goal ? rate.toFixed(1) + '%' : '목표를 설정해 줘';
  $('#goalDetail').textContent = goal
    ? (goal > equivalent ? '목표까지 ' + count(goal-equivalent) + '회 남았어' : '이번 달 목표를 달성했어')
    : '목표를 설정하면 달성률을 보여줄게';
  $('#workloadBreakdown').textContent = '실제 수업 ' + count(m.completed_lessons) + '건 · 50분 ' + count(m.fifty_count) + '건 · 90분 ' + count(m.ninety_count) + '건'
    + (Number(m.other_count) ? ' · 기타 ' + count(m.other_count) + '건' : '') + ' · 분할 차감은 중복 제외';
  $('#todayDone').textContent = count(m.today_completed) + '건';
}
function renderSchedule(calendar,m) {
  const upcoming = (calendar?.upcoming || []).filter(x => x.starts_at && new Date(x.starts_at).getTime() >= Date.now())
    .sort((a,b) => new Date(a.starts_at) - new Date(b.starts_at));
  const today = upcoming.filter(x => dayOf(x.starts_at) === m.today);
  $('#todayUpcoming').textContent = count(today.length) + '건';
  const list = $('#todaySchedule');
  list.replaceChildren();
  const displayed = today.length ? today.slice(0,4) : upcoming.slice(0,2);
  if (!displayed.length) {
    list.append(make('li','home-empty','오늘 남은 예약이 없어. 새로운 일정은 캘린더에서 확인해 줘.'));
  } else {
    if (!today.length) list.append(make('li','home-empty','오늘 남은 예약은 없어. 다음 일정이야.'));
    for (const item of displayed) {
      const li = make('li');
      const isToday = dayOf(item.starts_at) === m.today;
      const label = isToday ? clockKst.format(new Date(item.starts_at)) : shortKst.format(new Date(item.starts_at));
      li.append(make('span','home-time',label));
      const info = make('div','home-appointment');
      info.append(make('b',null,item.member_name || item.title || '회원 미연결 일정'));
      const duration = Math.max(0,Math.round((new Date(item.ends_at)-new Date(item.starts_at))/60000));
      info.append(make('small',null,(item.member_id ? '캘린더 예약' : '회원 연결 확인') + (duration ? ' · ' + duration + '분 블록' : '')));
      li.append(info);
      list.append(li);
    }
  }
  const lastSync = calendar?.summary?.last_synced_at;
  const syncInfo = $('#calendarSyncInfo');
  if (!lastSync) syncInfo.textContent = '캘린더 동기화 정보가 없어. 운영 대시보드에서 확인해 줘.';
  else {
    const elapsed = (Date.now() - new Date(lastSync).getTime()) / 3600000;
    syncInfo.textContent = '최근 캘린더 동기화 ' + shortKst.format(new Date(lastSync)) + ' ' + clockKst.format(new Date(lastSync))
      + (elapsed > 36 ? ' · 동기화 상태 확인 권장' : '');
  }
  return {today,upcoming};
}
function renewalCandidates(memberData) {
  const passes = new Map();
  for (const member of memberData?.rows || []) {
    if (!member.active || member.service_status !== 'operating') continue;
    const active = Array.isArray(member.active_passes) ? member.active_passes : [];
    const p = active[0];
    if (!p?.pass_id) continue;
    const id = String(p.pass_id);
    if (!passes.has(id)) passes.set(id,{...p,names:[],queued:false});
    passes.get(id).names.push(member.name);
    if (active.length > 1) passes.get(id).queued = true;
  }
  return [...passes.values()].filter(p => !p.queued && (p.unit_type === 'minute'
    ? Number(p.remaining_minutes) <= 150 : Number(p.remaining_sessions) <= 3))
    .sort((a,b) => {
      const aRemain = a.unit_type === 'minute' ? Number(a.remaining_minutes)/50 : Number(a.remaining_sessions);
      const bRemain = b.unit_type === 'minute' ? Number(b.remaining_minutes)/50 : Number(b.remaining_sessions);
      return aRemain - bRemain;
    });
}
function addTask(parent,{icon,title,detail,href}) {
  const link = make('a','home-task');
  link.href = href;
  link.append(make('span','home-task-icon',icon));
  const body = make('span','home-task-body');
  body.append(make('strong',null,title),make('small',null,detail));
  link.append(body,make('span','home-task-arrow','›'));
  parent.append(link);
}
function renderTasks(metrics,calendar,memberData,schedule) {
  const box = $('#homeTasks');
  box.replaceChildren();
  if (memberData) {
    const low = renewalCandidates(memberData);
    const names = low.slice(0,3).map(p => p.names.join('·') + ' ' + (p.unit_type === 'minute' ? p.remaining_minutes + '분' : p.remaining_sessions + '회'));
    addTask(box,{icon:'↻',title:'재등록 확인 ' + low.length + '권',detail:low.length ? names.join(' / ') : '잔량 3회·150분 이하인 활성 수강권 없음',href:'./member-session-manager/'});
  } else {
    addTask(box,{icon:'↻',title:'재등록 대상 확인',detail:'회원 정보를 불러오지 못했어. 회원 관리에서 확인해 줘.',href:'./member-session-manager/'});
  }
  addTask(box,{icon:'✓',title:'출석 기록 확인',detail:'오늘 완료 ' + count(metrics.today_completed) + '건 · 남은 예약 ' + count(schedule.today.length) + '건',href:'./attendance-manager/'});
  const unmatched = (schedule.upcoming || []).filter(x => !x.member_id).length;
  if (unmatched) {
    addTask(box,{icon:'!',title:'회원 연결 확인 ' + unmatched + '건',detail:'캘린더 일정과 회원 정보가 연결되지 않았어.',href:'./operations-dashboard/'});
  } else {
    addTask(box,{icon:'₩',title:'입금 내역 대조',detail:'등록액은 실제 입금액이 아닐 수 있어. 통장 잔액과 비교해 줘.',href:'./operations-dashboard/'});
  }
}
function renderFinance(cost,forecast) {
  const payment = cost?.summary?.month_payment_amount;
  const consumed = forecast?.summary?.actual_consumed;
  $('#homeRegistered').textContent = payment == null ? '확인 필요' : won(payment);
  $('#homeConsumed').textContent = consumed == null ? '확인 필요' : won(consumed);
}
async function load() {
  const id = ++requestId;
  const button = $('#homeRefresh');
  const status = $('#homeStatus');
  button.disabled = true;
  status.dataset.state = 'loading';
  status.textContent = '운영 데이터 확인 중';
  currentMonth = monthStart();
  const calls = [
    sb.rpc('quokka_home_metrics',{p_month:currentMonth}),
    sb.rpc('calendar_schedule_dashboard',{p_month:currentMonth}),
    sb.rpc('member_management_dashboard'),
    sb.rpc('operations_cost_dashboard',{p_month:currentMonth}),
    sb.rpc('operations_calendar_forecast_dashboard',{p_month:currentMonth})
  ];
  const results = await Promise.allSettled(calls);
  if (id !== requestId) return;
  const errors = [];
  const data = results.map((result,i) => {
    if (result.status === 'fulfilled' && !result.value.error) return result.value.data;
    const err = result.status === 'rejected' ? result.reason : result.value.error;
    errors.push(err?.message || '요청 ' + (i+1) + ' 실패');
    return null;
  });
  const [metrics,calendar,members,cost,forecast] = data;
  if (metrics) {
    renderGoal(metrics);
    const schedule = renderSchedule(calendar,metrics);
    renderTasks(metrics,calendar,members,schedule);
  } else {
    $('#workloadValue').textContent = '—';
    $('#goalDetail').textContent = '출석 집계를 불러오지 못했어. 새로고침해 줘.';
    $('#todaySchedule').replaceChildren(make('li','home-empty','캘린더 조회를 다시 시도해 줘.'));
    $('#homeTasks').replaceChildren(make('p','home-empty','운영 항목을 불러오지 못했어.'));
  }
  renderFinance(cost,forecast);
  status.dataset.state = errors.length ? 'error' : 'ready';
  status.textContent = errors.length ? '일부 정보 조회 실패 · 새로고침해 줘' : clockKst.format(new Date()) + ' 업데이트';
  if (errors.length) console.warn('홈 대시보드 일부 조회 실패',errors);
  button.disabled = false;
}

$('#loginForm').addEventListener('submit',async event => {
  event.preventDefault();
  const button = $('#homeLogin');
  button.disabled = true;
  $('#homeAuthMsg').textContent = '';
  try {
    const {error} = await sb.auth.signInWithPassword({email:$('#homeEmail').value.trim(),password:$('#homePassword').value});
    if (error) throw error;
    await init();
  } catch(error) {
    $('#homeAuthMsg').textContent = '로그인에 실패했어. 계정 정보를 확인해 줘.';
    console.warn('홈 로그인 실패',error?.message);
  } finally {button.disabled = false;}
});
$('#homeLogout').addEventListener('click',async () => {
  await sb.auth.signOut();
  showAuth();
});
$('#homeRefresh').addEventListener('click',load);
$('#editGoal').addEventListener('click',() => {
  $('#goalMonthText').textContent = currentMonth.slice(0,4) + '년 ' + Number(currentMonth.slice(5,7)) + '월 목표를 설정해.';
  $('#goalInput').value = lastMetrics?.target ?? '';
  $('#goalMsg').textContent = '';
  $('#goalModal').classList.remove('hide');
});
$('#goalCancel').addEventListener('click',() => $('#goalModal').classList.add('hide'));
$('#goalForm').addEventListener('submit',async event => {
  event.preventDefault();
  const goal = Number($('#goalInput').value);
  if (!Number.isFinite(goal) || goal < 1 || goal > 300 || goal*2 !== Math.trunc(goal*2)) {
    $('#goalMsg').textContent = '1~300회 사이에서 0.5회 단위로 입력해 줘.';
    return;
  }
  const button = $('#goalSave');
  button.disabled = true;
  $('#goalMsg').textContent = '저장 중…';
  try {
    const {error} = await sb.rpc('quokka_set_monthly_goal',{p_month:currentMonth,p_target:goal});
    if (error) throw error;
    $('#goalModal').classList.add('hide');
    await load();
  } catch(error) {
    console.error('월간 목표 저장 실패',error);
    $('#goalMsg').textContent = '목표 저장에 실패했어. 다시 시도해 줘.';
  } finally {button.disabled = false;}
});
init();