import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { createFeedbackController } from '../../src/utils/feedback.ts';

test('confirmations fail closed without a host, on cancellation, and on workspace teardown', async () => {
  const controller = createFeedbackController();
  assert.equal(await controller.confirmAction('Unattended action'), false);
  const unsubscribe = controller.subscribe(() => {});
  const request = controller.confirmAction('Delete fixture?');
  const id = controller.getSnapshot().confirmation!.id;
  assert.equal(await controller.confirmAction('Repeated click'), false);
  controller.answer(id, false);
  assert.equal(await request, false);
  const pending = controller.confirmAction('Restore fixture?');
  unsubscribe();
  assert.equal(await pending, false);
  assert.equal(controller.getSnapshot().confirmation, null);
});

test('only an explicit answer for the current confirmation can authorize an action', async () => {
  const controller = createFeedbackController();
  const unsubscribe = controller.subscribe(() => {});
  const first = controller.confirmAction('First');
  const oldId = controller.getSnapshot().confirmation!.id;
  controller.clear();
  assert.equal(await first, false);
  const next = controller.confirmAction('Second');
  const id = controller.getSnapshot().confirmation!.id;
  controller.answer(oldId, true);
  assert.equal(controller.getSnapshot().confirmation!.id, id);
  controller.answer(id, true);
  assert.equal(await next, true);
  controller.answer(id, true);
  unsubscribe();
});

test('notices stay bounded, do not authorize actions and do not outlive a protected workspace', () => {
  const normal = createFeedbackController();
  const protectedController = createFeedbackController();
  const unsubscribe = protectedController.subscribe(() => {});
  for (let i = 0; i < 10; i++) protectedController.notify(`Synthetic result ${i}`);
  assert.equal(protectedController.getSnapshot().notices.length, 4);
  assert.equal(normal.getSnapshot().notices.length, 0);
  const id = protectedController.getSnapshot().notices[0].id;
  protectedController.dismiss(id);
  assert.equal(protectedController.getSnapshot().notices.length, 3);
  unsubscribe();
  protectedController.notify('Late result after lock');
  assert.equal(protectedController.getSnapshot().notices.length, 0);
});

test('all renderer dialogs are non-native and every simple confirmation is awaited', () => {
  const root = fileURLToPath(new URL('../../src/', import.meta.url));
  const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
  let confirmations = 0;
  for (const path of visit(root)) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const check = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(source);
        assert.ok(!['alert', 'confirm', 'prompt', 'window.alert', 'window.confirm', 'window.prompt', 'globalThis.alert', 'globalThis.confirm'].includes(name), `${path}: native dialog ${name}`);
        if (name === 'confirmAction') {
          confirmations++;
          assert.ok(ts.isAwaitExpression(node.parent), `${path}: confirmation must be awaited`);
        }
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'NumericInput') {
        const value = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(source) === 'value');
        assert.ok(!value?.getText(source).includes('||'), `${path}: numeric draft must preserve empty strings and zero`);
      }
      ts.forEachChild(node, check);
    };
    check(source);
  }
  assert.ok(confirmations >= 17, 'global confirmation call sites covered');
});
