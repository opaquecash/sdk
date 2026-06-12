// ABIs inlined as TS modules: runtime ESM JSON imports require
// 'with { type: "json" }' attributes in plain Node and break non-bundler consumers.

/** Viem-compatible ABI for `StealthAddressAnnouncer` (announce + Announcement event). */
export const stealthAddressAnnouncerAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "schemeId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "stealthAddress",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "ephemeralPubKey",
        "type": "bytes"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "metadata",
        "type": "bytes"
      }
    ],
    "name": "Announcement",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "schemeId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "stealthAddress",
        "type": "address"
      },
      {
        "internalType": "bytes",
        "name": "ephemeralPubKey",
        "type": "bytes"
      },
      {
        "internalType": "bytes",
        "name": "metadata",
        "type": "bytes"
      }
    ],
    "name": "announce",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

/** Viem-compatible ABI for `StealthMetaAddressRegistry`. */
export const stealthMetaAddressRegistryAbi = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "StealthMetaAddressRegistry__InvalidSignature",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "registrant",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newNonce",
        "type": "uint256"
      }
    ],
    "name": "NonceIncremented",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "registrant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "schemeId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "stealthMetaAddress",
        "type": "bytes"
      }
    ],
    "name": "StealthMetaAddressSet",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "DOMAIN_SEPARATOR",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ERC6538REGISTRY_ENTRY_TYPE_HASH",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "incrementNonce",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "registrant",
        "type": "address"
      }
    ],
    "name": "nonceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "schemeId",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "stealthMetaAddress",
        "type": "bytes"
      }
    ],
    "name": "register",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "schemeId",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "stealthMetaAddress",
        "type": "bytes"
      }
    ],
    "name": "registerKeys",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "registrant",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "schemeId",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      },
      {
        "internalType": "bytes",
        "name": "stealthMetaAddress",
        "type": "bytes"
      }
    ],
    "name": "registerKeysOnBehalf",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "registrant",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "schemeId",
        "type": "uint256"
      }
    ],
    "name": "stealthMetaAddressOf",
    "outputs": [
      {
        "internalType": "bytes",
        "name": "",
        "type": "bytes"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
