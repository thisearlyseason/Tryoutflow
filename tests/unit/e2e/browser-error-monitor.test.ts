// @vitest-environment node

import { EventEmitter } from 'node:events';

import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { monitorBrowserErrors } from '../../../tests/e2e/helpers/network';

class FakePage extends EventEmitter {}

function failedRequest(input: {
  errorText: string;
  headers?: Record<string, string>;
  method: string;
  url: string;
}) {
  return {
    failure: () => ({ errorText: input.errorText }),
    headers: () => input.headers ?? {},
    method: () => input.method,
    url: () => input.url,
  };
}

function consoleError(text: string, url = '') {
  return {
    location: () => ({ url }),
    text: () => text,
    type: () => 'error',
  };
}

describe('Task 30 browser error monitor', () => {
  it('consumes an exact method, URL, error, header, and count contract', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    monitor.expectRequestFailure({
      count: 1,
      errorText: 'net::ERR_FAILED',
      headers: { 'next-action': /^action-[0-9]+$/u },
      label: 'modeled roster action response loss',
      method: 'POST',
      url: /^http:\/\/127\.0\.0\.1:3112\/app\/org\/rosters$/u,
    });

    page.emit(
      'requestfailed',
      failedRequest({
        errorText: 'net::ERR_FAILED',
        headers: { 'next-action': 'action-42' },
        method: 'POST',
        url: 'http://127.0.0.1:3112/app/org/rosters',
      }),
    );

    expect(() => monitor.assertClean()).not.toThrow();
  });

  it('fails an unrelated request even when its URL resembles an expected failure', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    monitor.expectRequestFailure({
      count: 1,
      errorText: 'net::ERR_FAILED',
      label: 'one exact mutation loss',
      method: 'POST',
      url: /^http:\/\/127\.0\.0\.1:3112\/api\/evaluations\/[^/]+\/mutations$/u,
    });
    page.emit(
      'requestfailed',
      failedRequest({
        errorText: 'net::ERR_FAILED',
        method: 'GET',
        url: 'http://127.0.0.1:3112/api/evaluations/not-the-mutation/mutations',
      }),
    );

    expect(() => monitor.assertClean()).toThrow(
      /unexpected request failure.*missing 1.*one exact mutation loss/su,
    );
  });

  it('fails when an expected failure is absent or occurs too many times', () => {
    const absentPage = new FakePage();
    const absent = monitorBrowserErrors(absentPage as unknown as Page);
    absent.expectConsoleError({
      count: 1,
      label: 'modeled browser resource diagnostic',
      text: 'Failed to load resource: net::ERR_FAILED',
    });
    expect(() => absent.assertClean()).toThrow(/missing 1.*modeled browser resource diagnostic/su);

    const duplicatePage = new FakePage();
    const duplicate = monitorBrowserErrors(duplicatePage as unknown as Page);
    duplicate.expectConsoleError({
      count: 1,
      label: 'one modeled diagnostic',
      text: /^Failed to load resource/u,
    });
    duplicatePage.emit('console', consoleError('Failed to load resource'));
    duplicatePage.emit('console', consoleError('Failed to load resource'));
    expect(() => duplicate.assertClean()).toThrow(/unexpected console error/u);
  });

  it('never consumes page errors and ignores only exact cancelled RSC GETs', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    page.emit(
      'requestfailed',
      failedRequest({
        errorText: 'net::ERR_ABORTED',
        method: 'GET',
        url: 'http://127.0.0.1:3112/app/org/home?_rsc=abc',
      }),
    );
    expect(() => monitor.assertClean()).not.toThrow();

    page.emit('pageerror', new Error('hydration exploded'));
    expect(() => monitor.assertClean()).toThrow(/pageerror: hydration exploded/u);
  });

  it('can detach a clean public-flow monitor before narrowly exempted auth setup', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    expect(() => monitor.assertClean()).not.toThrow();

    monitor.stop();
    page.emit(
      'requestfailed',
      failedRequest({
        errorText: 'net::ERR_ABORTED',
        headers: { 'next-action': 'auth-action' },
        method: 'POST',
        url: 'http://127.0.0.1:3112/sign-in',
      }),
    );

    expect(() => monitor.assertClean()).not.toThrow();
  });

  it('counts an exact Server Action request while accepting only its exact browser cancellation', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    monitor.expectCancellableRequest({
      count: 1,
      errorText: 'net::ERR_ABORTED',
      headers: { 'next-action': /^action-[0-9]+$/u },
      label: 'one exact onboarding action',
      method: 'POST',
      url: 'http://127.0.0.1:3112/start',
    });
    const request = failedRequest({
      errorText: 'net::ERR_ABORTED',
      headers: { 'next-action': 'action-42' },
      method: 'POST',
      url: 'http://127.0.0.1:3112/start',
    });
    page.emit('request', request);
    page.emit('requestfailed', request);

    expect(() => monitor.assertClean()).not.toThrow();
  });

  it('fails a missing, extra, or differently cancelled declared Server Action request', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    monitor.expectCancellableRequest({
      count: 1,
      errorText: 'net::ERR_ABORTED',
      headers: { 'next-action': /.+/u },
      label: 'one exact wizard action',
      method: 'POST',
      url: 'http://127.0.0.1:3112/app/org/setup/basics',
    });
    expect(() => monitor.assertClean()).toThrow(/missing 1.*one exact wizard action/su);

    const first = failedRequest({
      errorText: 'net::ERR_FAILED',
      headers: { 'next-action': 'action-one' },
      method: 'POST',
      url: 'http://127.0.0.1:3112/app/org/setup/basics',
    });
    const extra = failedRequest({
      errorText: 'net::ERR_ABORTED',
      headers: { 'next-action': 'action-two' },
      method: 'POST',
      url: 'http://127.0.0.1:3112/app/org/setup/basics',
    });
    page.emit('request', first);
    page.emit('requestfailed', first);
    page.emit('request', extra);
    page.emit('requestfailed', extra);
    expect(() => monitor.assertClean()).toThrow(
      /unexpected declared request.*unexpected request failure/su,
    );
  });
});
