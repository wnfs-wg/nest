import type { FileSystem } from '@wnfs-wg/nest'
import * as w3up from '@web3-storage/w3up-client'

import * as App from './app'
import * as Blockstore from './blockstore'
import * as FS from './fs'
import { Tracker } from './tracker'

// | (• ◡•)| (❍ᴥ❍ʋ)
//
// An example app that shows how to use WNFS with Web3Storage.

/**
 *
 */
async function setup(): Promise<{
  blockstore: Blockstore.Type
  client: w3up.Client
  fs: FileSystem
  isAuthenticated: boolean
  tracker: Tracker
}> {
  // 🌍 Web3Storage client, our remote storage.
  const client = await w3up.create()

  console.log('Client agent DID', client.agent.did())
  console.log('Client space DID:', client.currentSpace()?.did())

  console.log(
    'Client proofs',
    client.proofs().map((p) => {
      return {
        att: p.data.att,
        iss: p.data.iss.did(),
        aud: p.data.aud.did(),
      }
    })
  )

  // 🪃 The tracker keeps track of which blocks to upload remotely
  const tracker = await Tracker.create({ idbName: 'cid-tracker' })

  // 📦 The blockstore keeps around the individual data pieces of our file system
  const blockstore = await Blockstore.create({ idbName: 'blockstore', tracker })

  // 🗃️ Our file system, the data storage interface for our application
  const fs = await FS.load({ blockstore, client })

  // FS.EVENTS.PUBLISH – When the file system mutations settle,
  //                     store the file system blocks remotely.
  fs.on('publish', async (event) => {
    console.log('Publishing to Web3Storage:', event.dataRoot.toString())

    await Blockstore.flush({ client, tracker })
    await FS.Pointer.save({
      client,
      dataRoot: event.dataRoot,
      location: 'remote',
    })
  })

  // FS.EVENTS.COMMIT – Immediately after performing a file system mutation,
  //                    save the file system pointer locally.
  fs.on('commit', async (event) => {
    await FS.Pointer.save({
      client,
      dataRoot: event.dataRoot,
      location: 'local',
    })
  })

  // 💁 The account system associated with Web3Storage.
  //
  //    We're considered authenticated if the w3up client's
  //    active space DID (if any) matches the file system's assigned DID (if any).
  const activeSpace = client.currentSpace()
  const fsIdentity = await FS.Identity.lookup({ fs })
  const isAuthenticated =
    activeSpace === undefined ? false : fsIdentity === activeSpace.did()

  // Fin
  return {
    blockstore,
    client,
    fs,
    isAuthenticated,
    tracker,
  }
}

// Example app, todo list.

const components = await setup()
await App.init(components)

// Debug

globalThis.fs = components.fs
