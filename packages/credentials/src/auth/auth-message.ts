//
// Copyright 2020 DXOS.org
//

import assert from 'assert';

import { PublicKey, PublicKeyLike } from '@dxos/crypto';

import { Keyring } from '../keys';
import { wrapMessage } from '../party/party-credential';
import { Auth, KeyChain, Message } from '../proto';
import { WithTypeUrl } from '../proto/any';
import { KeyRecord } from '../typedefs';

/**
 * Create `dxos.credentials.auth.Auth` credentials.
 */
export const createAuthMessage = (
  keyring: Keyring,
  partyKey: PublicKeyLike,
  identityKey: KeyRecord,
  deviceKey: KeyRecord | KeyChain,
  feedKey?: KeyRecord,
  nonce?: Buffer
): WithTypeUrl<Message> => {
  assert(keyring);

  partyKey = PublicKey.from(partyKey);
  const devicePublicKey = PublicKey.from(deviceKey.publicKey);

  const signingKeys = [deviceKey];
  if (feedKey) {
    signingKeys.push(feedKey);
  }

  const authMessage: WithTypeUrl<Auth> = {
    __type_url: 'dxos.credentials.auth.Auth',
    partyKey: partyKey.asBuffer(),
    identityKey: identityKey.publicKey.asBuffer(),
    deviceKey: devicePublicKey.asBuffer(),
    feedKey: feedKey?.publicKey.asBuffer()
  };

  return wrapMessage(keyring.sign(authMessage, signingKeys, nonce));
};
