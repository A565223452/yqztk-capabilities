/**
 * privacy/mask-pii 的能力测试
 * 这些断言的作用不是「跑一遍不出错」，而是把能力的承诺钉死：
 * 结果确定、坐标精确、弱哈希已被替换、失败边界明确。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { maskPII, maskText } from '../src/privacy/mask-pii.mjs';

const sha256_12 = (value, salt = '') =>
  createHash('sha256').update(String(salt) + '\u0000' + value, 'utf8').digest('hex').slice(0, 12);

test('asterisk：email 保留首字符与 TLD（与站点工具一致）', () => {
  assert.equal(maskText('john@example.com', { types: ['email'] }), 'j***@e***.com');
});

test('asterisk：短用户名仍补足三个星号', () => {
  assert.equal(maskText('ab@example.com', { types: ['email'] }), 'a***@e***.com');
});

test('asterisk：phone 按数字位取前后段，能吃掉 +1 (555) 这类写法', () => {
  assert.equal(maskText('+1 (555) 123-4567', { types: ['phone'] }), '155-***-4567');
});

test('asterisk：card 只保留末四位', () => {
  assert.equal(maskText('4111 1111 1111 1111', { types: ['card'] }), '****-****-****-1111');
});

test('asterisk：ssn 与 ip 与 zip', () => {
  assert.equal(maskText('123-45-6789', { types: ['ssn'] }), '***-**-6789');
  assert.equal(maskText('192.168.1.1', { types: ['ip'] }), '***.**.1.1');
  assert.equal(maskText('94103', { types: ['zip'] }), '***03');
});

test('规则优先级：卡号不会被 phone 规则截断（同起点时具体规则胜出）', () => {
  const out = maskText('4111 1111 1111 1111', { types: ['card', 'phone'] });
  assert.equal(out, '****-****-****-1111');
  assert.ok(!out.includes('411'), '卡号前三位不得残留');
});

test('full 与 type 两种风格', () => {
  assert.equal(maskText('a@b.com', { types: ['email'], style: 'full' }), '*****@****.***');
  assert.equal(maskText('a@b.com', { types: ['email'], style: 'type' }), '[EMAIL]');
  assert.equal(maskText('4111 1111 1111 1111', { types: ['card'], style: 'type' }), '[CREDIT_CARD]');
});

test('[F1] hash 风格使用真 SHA-256，而非站点实现里的 32 位弱哈希', () => {
  const { output } = maskPII('john@example.com', { types: ['email'], style: 'hash' });
  assert.equal(output, `[EMAIL:${sha256_12('john@example.com')}]`);
  assert.match(output, /^\[EMAIL:[0-9a-f]{12}\]$/, '必须是 12 位十六进制');
});

test('[F1] 站点旧的 32 位哈希值不会出现在输出中（证明弱哈希已被移除）', () => {
  const weak = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(36).slice(0, 6);
  };
  const target = 'john@example.com';
  const { output } = maskPII(target, { types: ['email'], style: 'hash' });
  assert.ok(!output.includes(weak(target)), '输出中不得含可暴力枚举的弱哈希片段');
  assert.ok(!output.includes(weak(target.slice(0, 4))), '输出中不得含弱哈希前缀变体');
});

test('hash 加盐：同一原文不同 salt 产生不同掩码，不可跨库关联', () => {
  const a = maskPII('a@b.com', { types: ['email'], style: 'hash', salt: 'tenant-a' }).output;
  const b = maskPII('a@b.com', { types: ['email'], style: 'hash', salt: 'tenant-b' }).output;
  const again = maskPII('a@b.com', { types: ['email'], style: 'hash', salt: 'tenant-a' }).output;
  assert.notEqual(a, b, '不同租户之间不可关联');
  assert.equal(a, again, '相同 salt 下必须保持确定性，便于统计去重');
});

test('[F2] detections 坐标可直接从原文切片还原（证明位置精确）', () => {
  const text = 'Contact john@example.com or use 4111 1111 1111 1111 before 2026.';
  const { detections } = maskPII(text);
  assert.ok(detections.length >= 2);
  for (const d of detections) {
    assert.equal(text.slice(d.start, d.end), d.value, `${d.type} 的坐标不正确`);
  }
});

test('[F2] detections 顺序按出现位置升序，且不重叠', () => {
  const { detections } = maskPII('a@b.com then 4111 1111 1111 1111 then c@d.com');
  for (let i = 1; i < detections.length; i++) {
    assert.ok(detections[i].start >= detections[i - 1].end, '检测区间不得重叠');
  }
});

test('输出幂等：对已脱敏文本再跑一次不再改变', () => {
  const text = 'a@b.com and 4111 1111 1111 1111 and 123-45-6789';
  const once = maskPII(text).output;
  assert.equal(maskPII(once).output, once);
});

test('把 detections 的替换结果拼回去，等于 output（证明输出与轨迹一致）', () => {
  const text = 'mail a@b.com card 4111 1111 1111 1111';
  const { output, detections } = maskPII(text);
  let rebuilt = text;
  for (let i = detections.length - 1; i >= 0; i--) {
    const d = detections[i];
    rebuilt = rebuilt.slice(0, d.start) + d.replacement + rebuilt.slice(d.end);
  }
  assert.equal(rebuilt, output);
});

test('types 过滤生效：未勾选的类型保持原样', () => {
  const out = maskText('a@b.com 4111 1111 1111 1111', { types: ['email'] });
  assert.ok(out.includes('4111 1111 1111 1111'), '未勾选 card 时卡号不应被改动');
  assert.ok(out.includes('a***@b***.com'));
});

test('空值与非法输入不抛错（失败边界明确且宽容）', () => {
  assert.equal(maskPII('').output, '');
  assert.equal(maskPII(null).output, '');
  assert.equal(maskPII(undefined).output, '');
  assert.deepEqual(maskPII(undefined).detections, []);
  assert.equal(maskPII(true).output, 'true', '非字符串入参应经 String() 转换后处理');
  assert.equal(maskPII(12345).output, '***45', '5 位纯数字会命中 zip 规则，这是预期行为而非缺陷');
  assert.equal(maskPII(42).output, '42', '不足 5 位的数字不应被识别');
});

test('未知 style 回落为 asterisk（不静默产出空结果）', () => {
  assert.equal(maskText('a@b.com', { types: ['email'], style: 'nonsense' }), 'a***@b***.com');
});

test('确定性：连续两次调用结果完全一致', () => {
  const text = 'x@y.com 4111 1111 1111 1111 123-45-6789 10.0.0.1 94103';
  assert.deepEqual(maskPII(text), maskPII(text));
});
