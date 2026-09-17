import type {UserSettings,SessionKind} from './types.js';
export function localDate(date:Date,timezone:string) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function weekStart(date:Date,timezone='America/Mexico_City') {
  const d=new Date(localDate(date,timezone)+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)); return d.toISOString().slice(0,10);
}
export function dailyPlan(user:UserSettings,date=new Date()): {kind:SessionKind;meeting:'midweek'|'weekend';week:string} {
  const d=new Date(localDate(date,user.timezone)+'T12:00:00Z'), day=d.getUTCDay();
  const mw=(user.midweekDay-day+7)%7, we=(user.weekendDay-day+7)%7;
  const meeting=mw<=we?'midweek':'weekend', gap=Math.min(mw,we);
  const kind:SessionKind=gap<=1?'review':meeting==='midweek'?(gap>=4?'discovery':gap===3?'deepening':'application'):(gap>=4?'discovery':gap===3?'deepening':'comment');
  const target=new Date(d); target.setUTCDate(d.getUTCDate()+gap);
  return {kind,meeting,week:weekStart(target,'UTC')};
}
export function configure(user:UserSettings,args:string):UserSettings {
  if(!args.trim()) return user;
  const [time,midweek,weekend,timezone=user.timezone]=args.trim().split(/\s+/);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !/^[0-6]$/.test(midweek??'') || !/^[0-6]$/.test(weekend??'')) throw new Error('Usa /configurar HH:MM DIA_ENTRE_SEMANA DIA_FIN_SEMANA Zona/Horaria. Días: 0 domingo a 6 sábado.');
  new Intl.DateTimeFormat('es',{timeZone:timezone}).format();
  return {...user,studyTime:time,midweekDay:Number(midweek),weekendDay:Number(weekend),timezone};
}
