import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seedCases,relatedCases} from '../src/domain.mjs';
test('related cases identify cross-bureau overlaps without linking different categories',()=>{const cases=seedCases();const pairs=relatedCases(cases);assert.equal(pairs.length,2);assert.ok(pairs.every(p=>p.crossBureau));assert.ok(pairs.some(p=>[p.a,p.b].includes('CASE-1042')&&[p.a,p.b].includes('CASE-1041')));assert.ok(!pairs.some(p=>[p.a,p.b].includes('CASE-1032')));});
test('resolved complaints do not trigger active overlap alerts',()=>{const cases=seedCases();cases.find(c=>c.id==='CASE-1041').status='Resolved';assert.equal(relatedCases(cases).length,1);});
test('different institutions are not linked by similar wording',()=>{const cases=seedCases().slice(0,2);cases[1].institutionId='different';cases[1].institution='Different College';assert.equal(relatedCases(cases).length,0);});
test('matching names do not override conflicting institution IDs',()=>{const cases=seedCases().slice(0,2);cases[1].institutionId='1-999';assert.equal(relatedCases(cases).length,0);});
test('same category alone does not establish overlap',()=>{const cases=seedCases().slice(0,2);cases[1].title='Separate issue entirely';cases[1].description='Unrelated complaint about a different programme.';assert.equal(relatedCases(cases).length,0);});
