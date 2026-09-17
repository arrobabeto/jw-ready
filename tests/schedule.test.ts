import test from 'node:test';import assert from 'node:assert/strict';import {weekStart,configure,dailyPlan} from '../src/schedule.js';import {user} from './helpers.js';
test('Mexico Sunday remains prior week when UTC is Monday',()=>assert.equal(weekStart(new Date('2026-09-21T01:00:00Z')),'2026-09-14'));
test('year boundary uses correct Monday',()=>assert.equal(weekStart(new Date('2027-01-01T18:00:00Z')),'2026-12-28'));
test('schedule targets next meeting',()=>{assert.equal(dailyPlan(user,new Date('2026-09-17T18:00:00Z')).meeting,'weekend');assert.equal(dailyPlan(user,new Date('2026-09-22T18:00:00Z')).kind,'review');});
test('settings validate time, weekday and timezone',()=>{assert.equal(configure(user,'08:15 4 0 UTC').midweekDay,4);for(const a of ['25:00 3 6 UTC','08:00 8 9 UTC','08:00 3 6 Mars/Orbit']) assert.throws(()=>configure(user,a));});
