CREATE OR REPLACE FUNCTION public.quokka_home_metrics(p_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Seoul')::date)::timestamp)::date;
  v_start timestamptz;
  v_end timestamptz;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_goal numeric;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION 'Owner access required' USING errcode = '42501';
  END IF;
  IF v_month < date '2020-01-01' OR v_month > date '2100-12-01' THEN
    RAISE EXCEPTION 'Invalid month' USING errcode = '22023';
  END IF;
  v_start := v_month::timestamp at time zone 'Asia/Seoul';
  v_end := (v_month + interval '1 month') at time zone 'Asia/Seoul';
  SELECT nullif(value,'')::numeric INTO v_goal
    FROM public.app_settings
    WHERE key = 'monthly_goal_' || to_char(v_month,'YYYY-MM');
  WITH raw AS (
    SELECT a.id,a.member_id,a.pass_id,a.duration_minutes,a.attended_at,
      (a.attended_at at time zone 'Asia/Seoul')::date AS local_day
    FROM public.attendance a
    WHERE a.voided_at IS NULL AND a.attendance_status = 'attended'
      AND a.attended_at >= v_start AND a.attended_at < v_end
      AND a.attended_at <= now()
  ), neighbors AS (
    SELECT raw.*,
      lag(duration_minutes) over(partition by member_id,local_day order by attended_at,id) AS prev_minutes,
      lag(pass_id) over(partition by member_id,local_day order by attended_at,id) AS prev_pass,
      lag(attended_at) over(partition by member_id,local_day order by attended_at,id) AS prev_at
    FROM raw
  ), flagged AS (
    SELECT neighbors.*,
      CASE WHEN prev_pass IS NOT NULL AND prev_pass <> pass_id
        AND least(prev_minutes,duration_minutes) < 50
        AND prev_minutes + duration_minutes <= 90
        AND attended_at - prev_at BETWEEN interval '0 seconds' AND interval '90 minutes'
      THEN 0 ELSE 1 END AS new_lesson
    FROM neighbors
  ), grouped AS (
    SELECT flagged.*,
      sum(new_lesson) over(partition by member_id,local_day order by attended_at,id) AS lesson_group
    FROM flagged
  ), lessons AS (
    SELECT member_id,local_day,lesson_group,
      sum(duration_minutes)::int AS minutes,count(*)::int AS rows_in_lesson
    FROM grouped GROUP BY member_id,local_day,lesson_group
  )
  SELECT jsonb_build_object(
    'month',to_char(v_month,'YYYY-MM'),
    'today',to_char(v_today,'YYYY-MM-DD'),
    'as_of',now(),
    'target',v_goal,
    'completed_lessons',count(*)::int,
    'equivalent',coalesce(sum(CASE WHEN minutes >= 140 THEN 2.5::numeric WHEN minutes >= 90 THEN 1.5::numeric ELSE 1::numeric END),0),
    'fifty_count',count(*) filter(where minutes = 50)::int,
    'ninety_count',count(*) filter(where minutes = 90)::int,
    'other_count',count(*) filter(where minutes NOT IN (50,90))::int,
    'today_completed',count(*) filter(where local_day = v_today)::int,
    'today_equivalent',coalesce(sum(CASE WHEN minutes >= 140 THEN 2.5::numeric WHEN minutes >= 90 THEN 1.5::numeric ELSE 1::numeric END) filter(where local_day = v_today),0),
    'today_no_show',(SELECT count(*)::int FROM public.attendance a WHERE a.voided_at IS NULL AND a.attendance_status='no_show' AND (a.attended_at at time zone 'Asia/Seoul')::date = v_today)
  ) INTO v_result FROM lessons;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.quokka_home_metrics(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quokka_home_metrics(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.quokka_set_monthly_goal(p_month date, p_target numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_month date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION 'Owner access required' USING errcode = '42501';
  END IF;
  IF p_month IS NULL OR p_target IS NULL OR p_target < 1 OR p_target > 300
    OR p_target * 2 <> trunc(p_target * 2) THEN
    RAISE EXCEPTION 'Goal must be 1-300 in 0.5 increments' USING errcode = '22023';
  END IF;
  v_month := date_trunc('month',p_month::timestamp)::date;
  IF v_month < date '2020-01-01' OR v_month > date '2100-12-01' THEN
    RAISE EXCEPTION 'Invalid month' USING errcode = '22023';
  END IF;
  INSERT INTO public.app_settings(key,value)
  VALUES('monthly_goal_' || to_char(v_month,'YYYY-MM'),p_target::text)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
  RETURN p_target;
END;
$function$;
REVOKE ALL ON FUNCTION public.quokka_set_monthly_goal(date,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quokka_set_monthly_goal(date,numeric) TO authenticated;

INSERT INTO public.app_settings(key,value)
VALUES('monthly_goal_2026-11','90')
ON CONFLICT (key) DO NOTHING;