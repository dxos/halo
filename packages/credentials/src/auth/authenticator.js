//
// Copyright 2019 DXOS.org
//

import assert from 'assert';
import debug from 'debug';
import moment from 'moment';

import { keyToString } from '@dxos/crypto';

import { Keyring, KeyType } from '../keys';
import { codec } from '../proto';

const log = debug('dxos:creds:auth');

const MAX_AGE = 24 * 60 * 60; // One day.

/**
 * Abstract base class for Authenticators.
 * Used by AuthPlugin for authenticating nodes during handshake.
 */
// TODO(telackey): explain here the intention behind the abstract base class: is in the future to have
// different authentication methods (besides the current PartyAuthenticator) for replication auth,
// or to use this base class everywhere auth is done in the project (not used in greeting at present, for example)?
export class Authenticator {
  // TODO(dboreham): The following static methods:
  // temporary work around move encapsualtion breaking code from data-client/partitions.js.
  /**
   *
   * @param {Object} credentials
   * @return {Buffer} encoded result
   */
  // TODO(telackey): explain why the base64 encoding
  static encodePayload (credentials) {
    return codec.encode(credentials);
  }

  /**
   * Return true if the credentials checkout, else false.
   * @param credentials
   * @returns {Promise<boolean>}
   */
  async authenticate(credentials) { // eslint-disable-line
    throw new Error('Not Implemented');
  }
}

/**
 * A Party-based Authenticator, which checks that the supplied credentials belong to a Party member.
 */
export class PartyAuthenticator extends Authenticator {
  /**
   * Takes the target Party for checking admitted keys and verifying signatures.
   * @param party
   */
  constructor (party) {
    assert(party);
    super();

    this._party = party;
  }

  /**
   * Authenticate the credentials presented during handshake. The signature on the credentials must be valid and belong
   * to a key already admitted to the Party.
   * @param credentials
   * @returns {boolean} true if authenticated, else false
   */
  // TODO(dboreham): verify that credentials is a message of type dxos.credentials.SignedMessage signing a
  //  message of type dxos.credentials.auth.Auth.
  async authenticate (credentials) {
    assert(credentials);

    if (!credentials) {
      log('Bad credentials:', credentials);
      return false;
    }

    const { created, payload } = credentials.signed || {};
    const { deviceKey, identityKey, partyKey, feedKey } = payload || {};
    if (!created || !Buffer.isBuffer(deviceKey) || !Buffer.isBuffer(identityKey) || !Buffer.isBuffer(partyKey)) {
      log('Bad credentials:', credentials);
      return false;
    }

    // TODO(telackey): This is not how it should be done. We would rather use the remote
    // nonce for anti-replay, but we will need to add hooks for retrieving it and signing it
    // between connect() and handshake() to do that. In the meantime, not allowing infinite replay
    // is at least something.
    const then = moment(created, 'YYYY-MM-DDTHH:mm:ssZ', true);
    if (!then.isValid()) {
      log(`Bad credentials: invalid created ${created} time.`);
      return false;
    }

    const diff = moment().diff(then, 'seconds');
    if (Math.abs(diff) > MAX_AGE) {
      log(`Bad credentials: time skew too large: ${diff}ms`);
      return false;
    }

    // Check that the Party matches.
    if (!this._party.publicKey.equals(partyKey)) {
      log(`Wrong party: ${credentials}`);
      return false;
    }

    const verified = this._party.verifySignatures(credentials);

    // TODO(telackey): Find a better place to do this, since doing it here could be considered a side-effect.
    if (verified &&
      Buffer.isBuffer(feedKey) &&
      Keyring.signingKeys(credentials).find(key => feedKey.equals(key)) &&
      !this._party.memberFeeds.find(partyFeed => partyFeed.equals(feedKey))) {
      log(`Auto-hinting feedKey: ${keyToString(feedKey)} for Device ` +
        `${keyToString(deviceKey)} on Identity ${keyToString(identityKey)}`);
      await this._party.takeHints([{ publicKey: feedKey, type: KeyType.FEED }]);
    }

    return verified;
  }
}
