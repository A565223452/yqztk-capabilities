/**
 * security/password-strength 测试
 * 重点是 [F1]：大指数必须走对数路径，不能变成静默的 Infinity 或 NaN。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessPassword, generatePassword, crackSeconds, DEFAULT_COMMON_PASSWORDS } from '../src/security/password.mjs';

test('弱密码得低分并给出改进建议', () => {
  const r = assessPassword('abc');
  assert.ok(r.score < 30);
  assert.equal(r.level, 'very-weak');
  assert.ok(r.tips.some((t) => t.includes('12 个字符')));
});

test('强密码得高分', () => {
  const r = assessPassword('Tr0ub4dor&3xK');
  assert.ok(r.score >= 70, `分数过低：${r.score}`);
  assert.ok(['strong', 'very-strong'].includes(r.level));
});

test('长度与字符类别都影响分数', () => {
  const short = assessPassword('aB3!');
  const long = assessPassword('aB3!'.repeat(4));
  assert.ok(long.score > short.score);
  const lower = assessPassword('abcdefghijkl');
  const mixed = assessPassword('aBcDeFgHiJkL');
  assert.ok(mixed.score > lower.score);
});

test('常见密码分数被限制在 20 以内', () => {
  const r = assessPassword('password');
  assert.ok(r.score <= 20, `实际 ${r.score}`);
  assert.equal(r.patterns.isCommon, true);
  assert.ok(r.warnings.some((w) => w.includes('常见密码表')));
});

test('连续序列与重复字符会被扣分', () => {
  const seq = assessPassword('abcdefgh1234');
  assert.equal(seq.patterns.hasSequence, true);
  const rep = assessPassword('aaabbbccc');
  assert.equal(rep.patterns.hasRepeat, true);
});

test('[F1] 超长密码的破解时间走对数路径，超出双精度上限时为 Infinity 且有明确告警', () => {
  // 44 字符 × log10(95) ≈ 77 个数量级 —— 仍是有限值，说明对数路径生效（未溢出）
  const long = assessPassword('aB3!' + 'x'.repeat(40));
  assert.ok(Number.isFinite(long.crackTime.seconds), '44 字符仍应在双精度范围内');
  assert.ok(long.crackTime.seconds > 1e70);
  assert.ok(long.crackTime.display.includes('age of the universe'));

  // 超过约 308 个数量级后才有必要退化为 Infinity
  const huge = assessPassword('aB3!' + 'x'.repeat(200));
  assert.equal(huge.crackTime.seconds, Infinity);
  assert.equal(huge.crackTime.display, 'effectively forever');
  assert.ok(!Number.isNaN(huge.crackTime.seconds));
  assert.ok(huge.warnings.some((w) => w.includes('双精度')));
});

test('破解时间随长度单调增加', () => {
  const a = assessPassword('aB3!aB3!').crackTime.seconds;
  const b = assessPassword('aB3!aB3!aB3!').crackTime.seconds;
  assert.ok(b > a);
});

test('crackSeconds 用对数计算，不产生溢出', () => {
  assert.equal(crackSeconds(95, 12) > 0, true);
  assert.equal(crackSeconds(95, 300), Infinity);
  assert.equal(Number.isFinite(crackSeconds(26, 10)), true);
});

test('crackTime 的显示分档覆盖各量级', () => {
  assert.equal(assessPassword('a').crackTime.display, 'instantly');
  assert.match(assessPassword('abcdefgh').crackTime.display, /(seconds|minutes|hours|days|years)/);
});

test('返回值不包含原始密码本身（避免意外落盘）', () => {
  const r = assessPassword('S3cret!Pass');
  const json = JSON.stringify(r);
  assert.equal(json.includes('S3cret!Pass'), false);
});

test('[F2] 生成密码可复现', () => {
  const a = generatePassword({ length: 16, seed: 99 });
  const b = generatePassword({ length: 16, seed: 99 });
  assert.deepEqual(a.passwords, b.passwords);
});

test('[F2] 不同 seed 得到不同密码', () => {
  assert.notDeepEqual(
    generatePassword({ length: 16, seed: 1 }).passwords,
    generatePassword({ length: 16, seed: 2 }).passwords
  );
});

test('生成密码：长度正确且每个所选字符集至少出现一次', () => {
  const r = generatePassword({ length: 12, seed: 5, sets: ['lower', 'upper', 'digits', 'symbols'] });
  const p = r.passwords[0];
  assert.equal(p.length, 12);
  assert.match(p, /[a-z]/);
  assert.match(p, /[A-Z]/);
  assert.match(p, /[0-9]/);
  assert.match(p, /[^a-zA-Z0-9]/);
});

test('生成密码：排除易混淆字符', () => {
  const r = generatePassword({ length: 32, seed: 3, excludeAmbiguous: true, count: 3 });
  for (const p of r.passwords) {
    assert.doesNotMatch(p, /[il1Lo0O]/, `含易混淆字符：${p}`);
  }
});

test('生成密码：数量参数生效', () => {
  const r = generatePassword({ length: 10, seed: 1, count: 5 });
  assert.equal(r.passwords.length, 5);
  assert.equal(r.assessments.length, 5);
});

test('生成密码：声明随机源非密码学强度', () => {
  const r = generatePassword({ seed: 1 });
  assert.ok(r.warning.includes('密码学') || r.warning.includes('node:crypto'));
});

test('生成密码：非法输入抛错', () => {
  assert.throws(() => generatePassword({ length: 2 }), RangeError);
  assert.throws(() => generatePassword({ length: 200 }), RangeError);
  assert.throws(() => generatePassword({ sets: [] }), RangeError);
  assert.throws(() => generatePassword({ sets: ['nope'] }), RangeError);
  // 长度小于所选字符集数量时无法保证每类都出现，必须抛错
  assert.throws(() => generatePassword({ length: 3, sets: ['lower', 'upper', 'digits', 'symbols'] }), RangeError);
});

test('默认常见密码表覆盖高频弱密码', () => {
  for (const p of ['password', '123456', 'qwerty', 'admin']) {
    assert.ok(DEFAULT_COMMON_PASSWORDS.includes(p), `应包含 ${p}`);
  }
});

test('可注入自定义常见密码表', () => {
  const r = assessPassword('mypetname', { commonPasswords: ['mypetname'] });
  assert.equal(r.patterns.isCommon, true);
});

test('确定性：同输入两次结果一致', () => {
  assert.deepEqual(assessPassword('Zx9!kLm2'), assessPassword('Zx9!kLm2'));
});
