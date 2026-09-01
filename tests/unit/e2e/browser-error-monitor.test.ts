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

  it('bounds an implementation-defined request failure to zero or one exact occurrence', () => {
    const expectation = {
      errorText: 'Frame load interrupted',
      label: 'optional WebKit download handoff interruption',
      maxCount: 1,
      method: 'GET',
      url: 'http://127.0.0.1:3112/api/organizations/org/exports/roster',
    } as const;

    const absentPage = new FakePage();
    const absent = monitorBrowserErrors(absentPage as unknown as Page);
    absent.allowOptionalRequestFailure(expectation);
    expect(() => absent.assertClean()).not.toThrow();

    const presentPage = new FakePage();
    const present = monitorBrowserErrors(presentPage as unknown as Page);
    present.allowOptionalRequestFailure(expectation);
    presentPage.emit(
      'requestfailed',
      failedRequest({
        errorText: expectation.errorText,
        method: expectation.method,
        url: expectation.url,
      }),
    );
    expect(() => present.assertClean()).not.toThrow();

    const duplicatePage = new FakePage();
    const duplicate = monitorBrowserErrors(duplicatePage as unknown as Page);
    duplicate.allowOptionalRequestFailure(expectation);
    const exactFailure = failedRequest({
      errorText: expectation.errorText,
      method: expectation.method,
      url: expectation.url,
    });
    duplicatePage.emit('requestfailed', exactFailure);
    duplicatePage.emit('requestfailed', exactFailure);
    expect(() => duplicate.assertClean()).toThrow(/unexpected request failure/u);

    const mismatchPage = new FakePage();
    const mismatch = monitorBrowserErrors(mismatchPage as unknown as Page);
    mismatch.allowOptionalRequestFailure(expectation);
    mismatchPage.emit(
      'requestfailed',
      failedRequest({
        errorText: 'different failure',
        method: expectation.method,
        url: expectation.url,
      }),
    );
    expect(() => mismatch.assertClean()).toThrow(/unexpected request failure/u);
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

  it('fails an undeclared cancelled RSC GET and every page error', () => {
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
    expect(() => monitor.assertClean()).toThrow(
      /unexpected request failure: GET .*home\?_rsc=abc net::ERR_ABORTED/u,
    );

    page.emit('pageerror', new Error('hydration exploded'));
    expect(() => monitor.assertClean()).toThrow(
      /unexpected request failure.*pageerror: hydration exploded/su,
    );
  });

  it('consumes one exact declared RSC cancellation', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    monitor.expectRequestFailure({
      count: 1,
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      label: 'one exact home RSC cancellation',
      method: 'GET',
      url: 'http://127.0.0.1:3112/app/org/home?_rsc=abc',
    });
    page.emit(
      'requestfailed',
      failedRequest({
        errorText: 'net::ERR_ABORTED',
        headers: { rsc: '1' },
        method: 'GET',
        url: 'http://127.0.0.1:3112/app/org/home?_rsc=abc',
      }),
    );

    expect(() => monitor.assertClean()).not.toThrow();
  });

  it('binds a generated RSC URL to the exact initiating request before consuming its failure', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    monitor.expectRscCancellation({
      count: 1,
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      label: 'one generated home RSC cancellation',
      method: 'GET',
      url: 'http://127.0.0.1:3112/app/org/home?athletes=alpha,beta',
    });
    const request = failedRequest({
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      method: 'GET',
      url: 'http://127.0.0.1:3112/app/org/home?athletes=alpha,beta&_rsc=generated-token',
    });
    page.emit('request', request);
    page.emit('requestfailed', request);

    expect(() => monitor.assertClean()).not.toThrow();
  });

  it('fails unused, extra, and mismatched generated RSC cancellations', () => {
    const expectation = {
      count: 1,
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      label: 'one generated home RSC cancellation',
      method: 'GET',
      url: 'http://127.0.0.1:3112/app/org/home',
    } as const;
    const exactRequest = () =>
      failedRequest({
        errorText: 'net::ERR_ABORTED',
        headers: { rsc: '1' },
        method: 'GET',
        url: 'http://127.0.0.1:3112/app/org/home?_rsc=generated-token',
      });

    const unusedPage = new FakePage();
    const unused = monitorBrowserErrors(unusedPage as unknown as Page);
    unused.expectRscCancellation(expectation);
    expect(() => unused.assertClean()).toThrow(
      /missing 1 of 1: one generated home RSC cancellation/u,
    );

    const extraPage = new FakePage();
    const extra = monitorBrowserErrors(extraPage as unknown as Page);
    extra.expectRscCancellation(expectation);
    const first = exactRequest();
    const second = exactRequest();
    extraPage.emit('request', first);
    extraPage.emit('requestfailed', first);
    extraPage.emit('request', second);
    extraPage.emit('requestfailed', second);
    expect(() => extra.assertClean()).toThrow(/unexpected request failure/u);

    const mismatchPage = new FakePage();
    const mismatch = monitorBrowserErrors(mismatchPage as unknown as Page);
    mismatch.expectRscCancellation(expectation);
    const mismatched = failedRequest({
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      method: 'GET',
      url: 'http://127.0.0.1:3112/app/org/other?_rsc=generated-token',
    });
    mismatchPage.emit('request', mismatched);
    mismatchPage.emit('requestfailed', mismatched);
    expect(() => mismatch.assertClean()).toThrow(
      /unexpected request failure.*missing 1.*one generated home RSC cancellation/su,
    );
  });

  it('counts an exact generated RSC request and permits cancellation only for that request', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    monitor.expectCancellableRscRequest({
      count: 1,
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      label: 'one exact generated comparison request',
      method: 'GET',
      url: 'http://127.0.0.1:3112/app/org/compare?athletes=alpha,beta',
    });
    const request = failedRequest({
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      method: 'GET',
      url: 'http://127.0.0.1:3112/app/org/compare?athletes=alpha,beta&_rsc=generated',
    });
    page.emit('request', request);
    page.emit('requestfailed', request);

    expect(() => monitor.assertClean()).not.toThrow();
  });

  it('fails missing, extra, and mismatched generated cancellable RSC requests', () => {
    const expectation = {
      count: 1,
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      label: 'one exact generated comparison request',
      method: 'GET',
      url: 'http://127.0.0.1:3112/app/org/compare?athletes=alpha,beta',
    } as const;
    const exactRequest = () =>
      failedRequest({
        errorText: 'net::ERR_ABORTED',
        headers: { rsc: '1' },
        method: 'GET',
        url: `${expectation.url}&_rsc=generated`,
      });

    const missingPage = new FakePage();
    const missing = monitorBrowserErrors(missingPage as unknown as Page);
    missing.expectCancellableRscRequest(expectation);
    expect(() => missing.assertClean()).toThrow(
      /missing 1 of 1: one exact generated comparison request/u,
    );

    const extraPage = new FakePage();
    const extra = monitorBrowserErrors(extraPage as unknown as Page);
    extra.expectCancellableRscRequest(expectation);
    extraPage.emit('request', exactRequest());
    extraPage.emit('request', exactRequest());
    expect(() => extra.assertClean()).toThrow(/unexpected declared RSC request/u);

    const mismatchPage = new FakePage();
    const mismatch = monitorBrowserErrors(mismatchPage as unknown as Page);
    mismatch.expectCancellableRscRequest(expectation);
    const wrong = failedRequest({
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '0' },
      method: 'GET',
      url: `${expectation.url}&_rsc=generated`,
    });
    mismatchPage.emit('request', wrong);
    mismatchPage.emit('requestfailed', wrong);
    expect(() => mismatch.assertClean()).toThrow(
      /unexpected request failure.*missing 1.*one exact generated comparison request/su,
    );
  });

  it('fails extra, mismatched, and unused declared RSC cancellations', () => {
    const exactUrl = 'http://127.0.0.1:3112/app/org/home?_rsc=abc';
    const expectation = {
      count: 1,
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      label: 'one exact home RSC cancellation',
      method: 'GET',
      url: exactUrl,
    } as const;

    const extraPage = new FakePage();
    const extra = monitorBrowserErrors(extraPage as unknown as Page);
    extra.expectRequestFailure(expectation);
    const exactFailure = failedRequest({
      errorText: 'net::ERR_ABORTED',
      headers: { rsc: '1' },
      method: 'GET',
      url: exactUrl,
    });
    extraPage.emit('requestfailed', exactFailure);
    extraPage.emit('requestfailed', exactFailure);
    expect(() => extra.assertClean()).toThrow(/unexpected request failure/u);

    const mismatchedPage = new FakePage();
    const mismatched = monitorBrowserErrors(mismatchedPage as unknown as Page);
    mismatched.expectRequestFailure(expectation);
    mismatchedPage.emit(
      'requestfailed',
      failedRequest({
        errorText: 'net::ERR_ABORTED',
        headers: { rsc: '1' },
        method: 'GET',
        url: 'http://127.0.0.1:3112/app/org/other?_rsc=abc',
      }),
    );
    expect(() => mismatched.assertClean()).toThrow(
      /unexpected request failure.*missing 1.*one exact home RSC cancellation/su,
    );

    const unusedPage = new FakePage();
    const unused = monitorBrowserErrors(unusedPage as unknown as Page);
    unused.expectRequestFailure(expectation);
    expect(() => unused.assertClean()).toThrow(/missing 1 of 1: one exact home RSC cancellation/u);
  });

  it('detaches only the selected page monitor without hiding errors on another page', () => {
    const page = new FakePage();
    const monitor = monitorBrowserErrors(page as unknown as Page);
    const otherPage = new FakePage();
    const otherMonitor = monitorBrowserErrors(otherPage as unknown as Page);

    monitor.stop();
    page.emit('pageerror', new Error('detached page error'));
    otherPage.emit('pageerror', new Error('still monitored page error'));

    expect(() => monitor.assertClean()).not.toThrow();
    expect(() => otherMonitor.assertClean()).toThrow(/pageerror: still monitored page error/u);
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
