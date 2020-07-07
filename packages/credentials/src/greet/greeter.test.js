//
// Copyright 2019 DxOS
//

// dxos-testing-browser

import { randomBytes } from '@dxos/crypto';
import { ERR_EXTENSION_RESPONSE_FAILED } from '@dxos/protocol';

import { createKeyRecord, stripSecrets } from '../keys/keyring-helpers';
import { Filter, Keyring, KeyType } from '../keys';
import { createKeyAdmitMessage, createPartyInvitationMessage } from '../party';
import { validate } from '../proto';
import { Command } from './constants';
import { Greeter } from './greeter';

const createKeyring = async () => {
  const keyring = new Keyring();
  await keyring.createKeyRecord({ type: KeyType.PARTY });
  await keyring.createKeyRecord({ type: KeyType.IDENTITY });
  await keyring.createKeyRecord({ type: KeyType.DEVICE });
  return keyring;
};

const createGreeter = (keyring, hints = []) => new Greeter(
  keyring.findKey(Filter.matches({ type: KeyType.PARTY })).publicKey,
  messages => messages,
  () => hints
);

test('Good invitation', async () => {
  const keyring = await createKeyring();
  const secret = '0000';

  const hints = [
    { publicKey: randomBytes(32), type: KeyType.IDENTITY },
    { publicKey: randomBytes(32), type: KeyType.DEVICE },
    { publicKey: randomBytes(32), type: KeyType.FEED },
    { publicKey: randomBytes(32), type: KeyType.FEED }
  ];

  const greeter = createGreeter(keyring, hints);

  const secretProvider = async () => Buffer.from(secret);
  const secretValidator = async (invitation, secret) => secret && secret.equals(invitation.secret);
  const invitation = await greeter.createInvitation(
    keyring.findKey(Filter.matches({ type: KeyType.PARTY })).publicKey, secretValidator, secretProvider
  );

  // The `BEGIN` command informs the Greeter the Invitee has connected. This gives the Greeter an opportunity
  // to do things like create a passphrase on-demand rather than in advance.
  {
    const message = validate({
      payload: {
        __type_url: 'dxos.credentials.greet.Command',
        command: Command.Type.BEGIN
      }
    });

    await greeter.handleMessage(invitation.id, message.payload);
  }

  // The `HANDSHAKE` command allows the Greeter and Invitee to exchange any initial settings or details for
  // completing the exchange. It returns the `nonce` to use in the signed credential messages and the publicKey
  // of the target Party.
  let nonce;
  {
    const message = validate({
      payload: {
        __type_url: 'dxos.credentials.greet.Command',
        command: Command.Type.HANDSHAKE,
        secret: await secretProvider()
      }
    });

    const response = await greeter.handleMessage(invitation.id, message.payload);

    // The result will include a new token, and a challenge we'll need to include when signing.
    nonce = response.payload.nonce;
  }

  // In the `NOTARIZE` command, the Invitee 'submits' signed credentials to the Greeter to be written to the Party.
  // The Greeter wraps these credentials in an Envelope, which it signs, and returns signed copies to the Invitee.
  // The Greeter also returns 'hints' about the member keys and feeds keys already in the Party, so that the Invitee
  // will know whom to trust for replication.
  {
    const message = {
      payload: {
        __type_url: 'dxos.credentials.greet.Command',
        command: Command.Type.NOTARIZE,
        secret: await secretProvider(),
        params: [
          createKeyAdmitMessage(keyring,
            keyring.findKey(Filter.matches({ type: KeyType.PARTY })).publicKey,
            keyring.findKey(Keyring.signingFilter({ type: KeyType.IDENTITY })),
            [keyring.findKey(Keyring.signingFilter({ type: KeyType.IDENTITY }))],
            nonce
          )
        ]
      }
    };

    const response = await greeter.handleMessage(invitation.id, message.payload);

    expect(response.payload.hints.keys).toEqual(hints.keys);
    expect(response.payload.hints.feeds).toEqual(hints.feeds);

    // The `FINISH` command informs the Greeter the Invitee is done.
    {
      const message = validate({
        payload: {
          __type_url: 'dxos.credentials.greet.Command',
          command: Command.Type.FINISH,
          secret: await secretProvider()
        }
      });

      await greeter.handleMessage(invitation.id, message.payload);
    }
  }
});

test('Bad invitation secret', async (done) => {
  const keyring = await createKeyring();
  const greeter = createGreeter(keyring);

  const secretProvider = async () => Buffer.from('0000');
  const secretValidator = async (invitation, secret) => secret && secret.equals(invitation.secret);
  const invitation = await greeter.createInvitation(
    keyring.findKey(Filter.matches({ type: KeyType.PARTY })).publicKey, secretValidator, secretProvider
  );

  // Normal `BEGIN` command.
  {
    const message = validate({
      payload: {
        __type_url: 'dxos.credentials.greet.Command',
        command: Command.Type.BEGIN
      }
    });

    await greeter.handleMessage(invitation.id, message.payload);
  }

  // Bad secret in the `HANDSHAKE` command.
  {
    const message = validate({
      payload: {
        __type_url: 'dxos.credentials.greet.Command',
        command: Command.Type.HANDSHAKE,
        secret: Buffer.from('wrong')
      }
    });

    try {
      await greeter.handleMessage(invitation.id, message.payload);
      done.fail('Bad secret was allowed.');
    } catch (err) {
      expect(err).toBeInstanceOf(ERR_EXTENSION_RESPONSE_FAILED);
    }
  }

  done();
});

test('Attempt to re-use invitation', async (done) => {
  const keyring = await createKeyring();
  const greeter = createGreeter(keyring);

  const secretProvider = async () => Buffer.from('0000');
  const secretValidator = async (invitation, secret) => secret && secret.equals(invitation.secret);
  const invitation = await greeter.createInvitation(
    keyring.findKey(Filter.matches({ type: KeyType.PARTY })).publicKey, secretValidator, secretProvider
  );

  {
    const message = validate({
      payload: {
        __type_url: 'dxos.credentials.greet.Command',
        command: Command.Type.BEGIN
      }
    });

    await greeter.handleMessage(invitation.id, message.payload);
  }

  let nonce;
  {
    const message = validate({
      payload: {
        __type_url: 'dxos.credentials.greet.Command',
        command: Command.Type.HANDSHAKE,
        secret: await secretProvider()
      }
    });

    const response = await greeter.handleMessage(invitation.id, message.payload);

    // The result will include a new token, and a challenge we'll need to include when signing.
    nonce = response.payload.nonce;
  }

  {
    const message = {
      payload: {
        __type_url: 'dxos.credentials.greet.Command',
        command: Command.Type.NOTARIZE,
        secret: await secretProvider(),
        params: [
          createKeyAdmitMessage(keyring,
            keyring.findKey(Filter.matches({ type: KeyType.PARTY })).publicKey,
            keyring.findKey(Keyring.signingFilter({ type: KeyType.DEVICE })),
            [keyring.findKey(Keyring.signingFilter({ type: KeyType.DEVICE }))],
            nonce)
        ]
      }
    };

    await greeter.handleMessage(invitation.id, message.payload);

    // Now it is all used up, try submitting another command. It should fail.
    try {
      await greeter.handleMessage(invitation.id, message.payload);
      done.fail('Invitation re-use was allowed.');
    } catch (err) {
      expect(err).toBeInstanceOf(ERR_EXTENSION_RESPONSE_FAILED);
    }
  }

  done();
});

test('Wrong partyKey', async () => {
  const keyring = await createKeyring();
  const greeter = createGreeter(keyring);

  const wrongParty = randomBytes(32);

  await expect(() => {
    greeter.createInvitation(wrongParty, () => {
    }, () => {
    });
  }).toThrow(ERR_EXTENSION_RESPONSE_FAILED);
});

test('Create Invitation message ', async () => {
  const keyring = await createKeyring();

  const partyKey = keyring.findKey(Filter.matches({ type: KeyType.PARTY }));
  const issuerKey = keyring.findKey(Filter.matches({ type: KeyType.IDENTITY }));
  const inviteeKey = stripSecrets(createKeyRecord({ type: KeyType.IDENTITY }));

  const message = validate(createPartyInvitationMessage(keyring, partyKey.publicKey, issuerKey, inviteeKey, issuerKey));
  expect(keyring.verify(message.payload)).toBe(true);
});

test('WellKnownType params - BytesValue', async () => {
  const value = randomBytes();

  const command = validate({
    __type_url: 'dxos.credentials.Message',
    payload: {
      __type_url: 'dxos.credentials.greet.Command',
      command: Command.Type.CLAIM,
      secret: Buffer.from('123'),
      params: [
        {
          __type_url: 'google.protobuf.BytesValue',
          value
        }
      ]
    }
  });

  expect(command.payload.params[0].value).toEqual(value);
});
