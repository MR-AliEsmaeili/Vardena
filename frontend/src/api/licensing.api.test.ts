import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { apiClient } from './client';
import {
  activateDeviceEnrollment,
  cancelDeviceReplacement,
  createDeviceEnrollmentChallenge,
  createDeviceReplacementChallenge,
  deactivateClientDevice,
  exportDeviceReplacementRequest,
  getClientDeviceHistory,
  getClientDeviceInventory,
  importDeviceReplacementResponse,
  proveDeviceReplacement,
} from './licensing.api';

const originalAdapter = apiClient.defaults.adapter;

function captureRequests() {
  const requests: AxiosRequestConfig[] = [];
  apiClient.defaults.adapter = (config: AxiosRequestConfig) => {
    requests.push(config);
    const response = {
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    } as AxiosResponse;
    return Promise.resolve(response);
  };
  return requests;
}

afterEach(() => {
  if (originalAdapter === undefined) {
    delete apiClient.defaults.adapter;
  } else {
    apiClient.defaults.adapter = originalAdapter;
  }
});

describe('client-device API transport', () => {
  it('uses same-origin licensing routes and sends only public protocol inputs', async () => {
    const requests = captureRequests();
    const publicKey = 'MCowBQYDK2VwAyE' + 'a'.repeat(32);
    const signature = 'c2lnbmF0dXJl';
    const responseDocument = 'VDRP1.eyJmb3JtYXQiOiJWRFJQMSJ9.c2lnbmF0dXJl';

    await getClientDeviceInventory();
    await getClientDeviceHistory('device/one');
    await createDeviceEnrollmentChallenge({ publicKey });
    await activateDeviceEnrollment('challenge/one', { signature });
    await deactivateClientDevice('device/one');
    await createDeviceReplacementChallenge('old device', { publicKey });
    await proveDeviceReplacement('request/one', { signature });
    await exportDeviceReplacementRequest('request/one');
    await importDeviceReplacementResponse({ document: responseDocument });
    await cancelDeviceReplacement('request/one');

    expect(
      requests.map(({ method, url }) => [method?.toUpperCase(), url]),
    ).toEqual([
      ['GET', '/license/devices'],
      ['GET', '/license/devices/device%2Fone/history'],
      ['POST', '/license/devices/enrollment-challenges'],
      [
        'POST',
        '/license/devices/enrollment-challenges/challenge%2Fone/activate',
      ],
      ['POST', '/license/devices/device%2Fone/deactivate'],
      ['POST', '/license/devices/old%20device/replacement-challenges'],
      ['POST', '/license/devices/replacements/request%2Fone/prove'],
      ['GET', '/license/devices/replacements/request%2Fone/export'],
      ['POST', '/license/devices/replacements/import'],
      ['POST', '/license/devices/replacements/request%2Fone/cancel'],
    ]);

    expect(JSON.parse(String(requests[2]?.data))).toEqual({ publicKey });
    expect(JSON.parse(String(requests[3]?.data))).toEqual({ signature });
    expect(JSON.parse(String(requests[5]?.data))).toEqual({ publicKey });
    expect(JSON.parse(String(requests[6]?.data))).toEqual({ signature });
    expect(JSON.parse(String(requests[8]?.data))).toEqual({
      document: responseDocument,
    });
    expect(String(requests[2]?.data)).not.toContain('privateKey');
    expect(String(requests[8]?.data)).not.toContain('VDEA1');
  });
});
