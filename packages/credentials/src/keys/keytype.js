//
// Copyright 2020 DXOS.org
//

// TODO(burdon): Document.
// TODO(dboreham): Review key type usage and consider propagation of type in messages cf UNKNOWN
import { codec } from '../proto';

export const KeyType = Object.freeze({
  ...codec.getType('dxos.halo.credentials.party.KeyType').values
});

export const keyTypeName = (keyType) => {
  for (const type of Object.keys(KeyType)) {
    if (KeyType[type] === keyType) {
      return type;
    }
  }
  return undefined;
};
