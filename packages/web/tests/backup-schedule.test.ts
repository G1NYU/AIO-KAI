import { describe,expect,it } from 'vitest';
import { beginAttempt,configureSchedule,defaultSchedule,finishAttempt,parseSchedule,sameAttempt,scheduleIsDue } from '../src/lib/backup/schedule';
const day=86_400_000, now=1760000000000;
describe('opt-in backup schedule',()=>{
  it('defaults off, never runs invalid or unknown policies',()=>{
    expect(scheduleIsDue(defaultSchedule(),now)).toBe(false);
    for(const text of ['','{}',JSON.stringify({...defaultSchedule(),cadence:'hourly'}),JSON.stringify({...defaultSchedule(),keep:1}),JSON.stringify({...defaultSchedule(),token:'secret'})])
      expect(parseSchedule(text)).toEqual(defaultSchedule());
  });
  it('schedules daily or weekly from the opt-in time and preserves a due time when changing coverage',()=>{
    const daily=configureSchedule(defaultSchedule(),{cadence:'daily',includeManga:true,keep:7},now);
    expect(daily.dueMs).toBe(now+day);
    expect(scheduleIsDue(daily,now+day-1)).toBe(false);
    expect(scheduleIsDue(daily,now+day)).toBe(true);
    expect(configureSchedule(daily,{cadence:'daily',includeManga:false,keep:0},now+1000).dueMs).toBe(daily.dueMs);
    expect(configureSchedule(daily,{cadence:'weekly',includeManga:false,keep:0},now).dueMs).toBe(now+7*day);
    expect(configureSchedule(daily,{cadence:'off',includeManga:false,keep:0},now).dueMs).toBe(0);
  });
  it('reserves an interrupted attempt, bounds retry frequency and records only verified success',()=>{
    const due=configureSchedule(defaultSchedule(),{cadence:'daily',includeManga:false,keep:3},now-day);
    const started=beginAttempt(due,now);
    expect(scheduleIsDue(started,now+1000)).toBe(false);
    expect(scheduleIsDue(started,now+3_600_000)).toBe(true);
    expect(sameAttempt(parseSchedule(JSON.stringify(started)),started)).toBe(true);
    expect(sameAttempt({...started,keep:7},started)).toBe(false);
    expect(finishAttempt(started,now+100,'failed')).toMatchObject({lastVerifiedMs:null,dueMs:now+100+3_600_000});
    expect(finishAttempt(started,now+100,'retention-warning')).toMatchObject({lastVerifiedMs:now+100,dueMs:now+100+day});
    expect(finishAttempt(started,now+100,'saved').result).toBe('saved');
  });
});
