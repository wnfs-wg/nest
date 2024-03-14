import '@picocss/pico/css/pico.min.css'

import type * as w3up from '@web3-storage/w3up-client'
import type { Blockstore } from 'interface-blockstore'
import type { SharedSpace } from '@web3-storage/w3up-client/space'

import * as Delegation from '@ucanto/core/delegation'
import * as Ucanto from '@ucanto/core'
import { type DirectoryItem, type FileSystem, Path } from '@wnfs-wg/nest'
import { Consumer, Provider, type SendFn } from 'maake-oob'
import { PartyKitTransport as Transport } from 'partykit-transport'
import QRCode from 'qrcode'

import * as FS from './fs'
import { type Tracker } from './tracker'

// 🏔️

const TODOS_DIRECTORY = Path.directory('private', 'todos')
const TRANSPORT_HOST = 'radical-party.icidasset.partykit.dev'

let todos: DirectoryItem[] = []

let authedCtxElements: HTMLElement[] = []
let authingCtxElements: HTMLElement[] = []
let unauthedCtxElements: HTMLElement[] = []

let linkDialog: Element
let signInDialog: Element
let signUpDialog: Element

// 🏡

/**
 *
 * @param root0
 * @param root0.blockstore
 * @param root0.client
 * @param root0.fs
 * @param root0.isAuthenticated
 * @param root0.tracker
 */
export async function init({
  blockstore,
  client,
  fs,
  isAuthenticated,
  tracker,
}: {
  blockstore: Blockstore
  client: w3up.Client
  fs: FileSystem
  isAuthenticated: boolean
  tracker: Tracker
}): Promise<void> {
  await loadAndRender(fs)

  await initAuthed({ isAuthenticated })
  await initDelete(fs)
  await initInput(fs)
  await initLink({ client, fs })
  await initSignIn()
  await initSignUp({ blockstore, client, fs, tracker })

  if (isAuthenticated) await initProvider({ client, fs })
}

// AUTHED

/**
 *
 * @param root0
 * @param root0.isAuthenticated
 */
async function initAuthed({
  isAuthenticated,
}: {
  isAuthenticated: boolean
}): Promise<void> {
  setAuthedState(isAuthenticated ? 'authenticated' : 'not-authenticated')
}

/**
 *
 * @param root0
 * @param root0.isAuthenticated
 * @param state
 */
function setAuthedState(
  state: 'authenticated' | 'authenticating' | 'not-authenticated'
): void {
  authedCtxElements = [
    ...document.querySelectorAll('[data-context="authenticated"]'),
  ] as HTMLElement[]
  authingCtxElements = [
    ...document.querySelectorAll('[data-context="authenticating"]'),
  ] as HTMLElement[]
  unauthedCtxElements = [
    ...document.querySelectorAll('[data-context="not-authenticated"]'),
  ] as HTMLElement[]

  switch (state) {
    case 'authenticated': {
      for (const a of authedCtxElements) {
        a.classList.remove('hidden')
      }
      for (const a of authingCtxElements) {
        a.classList.add('hidden')
      }
      for (const a of unauthedCtxElements) {
        a.classList.add('hidden')
      }
      break
    }
    case 'authenticating': {
      for (const a of authedCtxElements) {
        a.classList.add('hidden')
      }
      for (const a of authingCtxElements) {
        a.classList.remove('hidden')
      }
      for (const a of unauthedCtxElements) {
        a.classList.add('hidden')
      }
      break
    }
    case 'not-authenticated': {
      for (const a of authedCtxElements) {
        a.classList.add('hidden')
      }
      for (const a of authingCtxElements) {
        a.classList.add('hidden')
      }
      for (const a of unauthedCtxElements) {
        a.classList.remove('hidden')
      }
      break
    }
  }
}

// DELETE

/**
 *
 * @param fs
 */
async function initDelete(fs: FileSystem): Promise<void> {
  /**
   *
   * @param event
   */
  async function onClick(event: Event): Promise<void> {
    const target: HTMLElement | undefined =
      event.target === null ? undefined : (event.target as HTMLElement)
    if (target === undefined) return

    // Delete todo
    if (target.getAttribute('role') === 'delete') {
      const todo =
        target.parentElement?.parentElement?.getAttribute('data-todo') ??
        undefined

      if (todo === undefined) throw new Error("Couldn't find associated todo")

      await fs.remove(Path.combine(TODOS_DIRECTORY, Path.file(todo)))
      await loadAndRender(fs)
    }
  }

  document.addEventListener('click', (event) => {
    onClick(event).catch(console.error)
  })
}

// DIALOGS

document.addEventListener('click', (event) => {
  const target: HTMLElement | undefined =
    event.target === null ? undefined : (event.target as HTMLElement)
  if (target === undefined) return

  // Dialog close button
  if (
    target.tagName === 'BUTTON' &&
    target.getAttribute('aria-label') === 'Close'
  ) {
    const dialogElement = target.closest('dialog')
    if (dialogElement !== null) hideDialog(dialogElement)
  }
})

/**
 *
 * @param dialogElement
 */
function hideDialog(dialogElement: Element | HTMLElement): void {
  dialogElement.removeAttribute('open')
}

/**
 *
 * @param dialogElement
 */
function showDialog(dialogElement: Element | HTMLElement): void {
  dialogElement.setAttribute('open', '')
}

// INPUT

/**
 *
 * @param fs
 */
async function initInput(fs: FileSystem): Promise<void> {
  const inputForm: HTMLElement = findElement('#input-form')

  inputForm.style.display = 'block'
  inputForm.addEventListener('submit', (event) => {
    onSubmit(event).catch(console.error)
  })

  /**
   *
   * @param event
   */
  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault()

    const input = findElement<HTMLInputElement>('input[type="text"]', inputForm)
    const button = findElement('input[type="submit"]', inputForm)

    button.setAttribute('disabled', '')

    const todo = input.value
    const todoPath = Path.combine(TODOS_DIRECTORY, Path.file(todo))

    await fs.write(todoPath, 'json', {})
    await loadAndRender(fs)

    input.value = ''

    button.removeAttribute('disabled')
  }
}

// LINK

type Payload = Uint8Array

/**
 *
 * @param fs.client
 * @param fs
 * @param fs.fs
 */
async function initLink({
  client,
  fs,
}: {
  client: w3up.Client
  fs: FileSystem
}): Promise<void> {
  linkDialog = findElement('dialog[role="device-link"]')
  connectDialogTrigger(linkDialog, '#device-link-trigger')

  const url = new URL(location.href)
  const challenge = url.searchParams.get('challenge')
  const publicKey = url.searchParams.get('publicKey')

  if (challenge !== null && publicKey !== null) {
    setAuthedState('authenticating')

    const adjustedUrl = new URL(url)
    adjustedUrl.searchParams.delete('challenge')
    adjustedUrl.searchParams.delete('publicKey')
    history.replaceState({}, '', adjustedUrl)

    try {
      await initConsumer({ challenge, client, publicKey })
    } catch (error) {
      setAuthedState('not-authenticated')
      throw error
    }
  }
}

/**
 *
 * @param challenge.challenge
 * @param challenge
 * @param publicKey
 * @param challenge.client
 * @param challenge.publicKey
 */
async function initConsumer({
  challenge,
  client,
  publicKey,
}: {
  challenge: string
  client: w3up.Client
  publicKey: string
}): Promise<void> {
  const consumer = new Consumer<Payload>({ challenge, publicKey })
  const transport = new Transport({
    peerId: consumer.id,
    room: publicKey,
    host: TRANSPORT_HOST,
  })

  const { send } = await consumer.consume({
    payloadDecoder,
    payloadEncoder,
    transport,
  })

  let space: SharedSpace | undefined

  await new Promise((resolve) => {
    consumer.on('message', async ({ msgId, payload }) => {
      // Proofs
      if (msgId === 'proof') {
        const delegation = await Delegation.extract(payload)
        if (delegation.error !== undefined)
          throw new Error('Failed to extract delegation')

        console.log('Added proof', delegation.ok)

        if (delegation.ok.data.att.some((a) => a.can === 'space/*')) {
          space = await client.addSpace(delegation.ok)
        } else {
          await client.addProof(delegation.ok)
        }
      }

      // Received access key
      if (msgId === 'key') {
        await FS.Keys.save({ key: payload, path: Path.root() })
        await FS.Pointer.delete({ client, location: 'local' })

        resolve(1)
      }
    })

    send('agent', new TextEncoder().encode(client.agent.did())).catch(
      console.error
    )
  })

  // Finish up
  if (space === undefined) {
    throw new Error('Space was not set during device link')
  }

  await client.setCurrentSpace(space.did())

  // Sorry got lazy here,
  // basically need to load a different file system.
  // Rather than implementing all that, it's easier to
  // just reset the app state by refreshing.
  location.reload()
}

/**
 *
 * @param fs.client
 * @param fs
 * @param fs.fs
 */
async function initProvider({
  client,
  fs,
}: {
  client: w3up.Client
  fs: FileSystem
}): Promise<void> {
  const provider = new Provider<Payload>()
  const transport = new Transport({
    peerId: provider.id,
    room: provider.params.publicKey,
    host: TRANSPORT_HOST,
  })

  const consumers: Record<
    string,
    { answer: SendFn<Payload>; send: SendFn<Payload> }
  > = {}

  provider.on('new-consumer', async ({ did, answer, send }) => {
    console.log('Secure tunnel established with', did)
    consumers[did] = { answer, send }
  })

  provider.on('message', async ({ did, msgId, payload }) => {
    if (msgId !== 'agent') return

    const remoteAgentDID = new TextDecoder().decode(
      payload
    ) as `did:${string}:${string}`

    const promises = client.proofs().map(async (proof) => {
      const delegation = await Ucanto.delegate({
        issuer: client.agent.issuer,
        audience: { did: () => remoteAgentDID },
        proofs: [proof],
        expiration: Number.POSITIVE_INFINITY,
        capabilities: proof.capabilities,
      })

      const prfArchive = await proof.archive()
      const delArchive = await delegation.archive()

      if (prfArchive.error !== undefined) throw prfArchive.error
      if (delArchive.error !== undefined) throw delArchive.error

      await consumers[did]?.send('proof', prfArchive.ok)
      await consumers[did]?.send('proof', delArchive.ok)
    })

    await Promise.all(promises)

    const key = await fs.capsuleKey(Path.directory('private'))
    if (key === undefined) throw new Error("Couldn't resolve access key")
    await consumers[did]?.send('key', key)
  })

  await provider.provide({
    payloadDecoder,
    payloadEncoder,
    transport,
  })

  const url = new URL(location.href)
  url.searchParams.set('challenge', provider.params.challenge)
  url.searchParams.set('publicKey', provider.params.publicKey)

  const qrCodeDataURL = await QRCode.toDataURL(url.toString())
  const qrCodeNode = findElement('#qr-code')

  qrCodeNode.innerHTML = `
    <p style="text-align: center;">
      <img src="${qrCodeDataURL}" />
    </p>
    <p>
      <a style="word-break: break-all;" href="${url.toString()}">${url.toString()}</a>
    </p>
    <p>
      <button id="copy-url">Copy URL</button>
    </p>
  `

  document.querySelector('#copy-url')?.addEventListener('click', (event) => {
    event.preventDefault()
    if (event.target !== null)
      (event.target as HTMLElement).innerHTML = 'URL copied'
    navigator.clipboard.writeText(url.toString()).catch(console.error)
  })
}

/**
 *
 * @param encoded
 */
function payloadDecoder(encoded: Uint8Array): Payload {
  return encoded
}

/**
 *
 * @param payload
 */
function payloadEncoder(payload: Payload): Uint8Array {
  return payload
}

// SIGN IN

/**
 *
 */
async function initSignIn(): Promise<void> {
  signInDialog = findElement('dialog[role="sign-in"]')
  connectDialogTrigger(signInDialog, '#sign-in-trigger')
}

// SIGN UP

/**
 *
 * @param root0
 * @param root0.blockstore
 * @param root0.client
 * @param root0.fs
 * @param root0.tracker
 */
async function initSignUp({
  blockstore,
  client,
  fs,
  tracker,
}: {
  blockstore: Blockstore
  client: w3up.Client
  fs: FileSystem
  tracker: Tracker
}): Promise<void> {
  signUpDialog = findElement('dialog[role="sign-up"]')
  connectDialogTrigger(signUpDialog, '#sign-up-trigger')

  const signUpForm = findElement('form[role="sign-up"]')
  signUpForm.addEventListener('submit', (event: Event) => {
    onSubmit(event).catch(console.error)
  })

  /**
   *
   * @param event
   */
  async function onSubmit(event: Event): Promise<void> {
    event.preventDefault()

    const email: HTMLInputElement = findElement(
      'input[name="email"]',
      signUpForm
    )

    const spaceName: HTMLInputElement = findElement(
      'input[name="space-name"]',
      signUpForm
    )

    // Disable submit button
    for (const n of document.querySelectorAll(`button[type="submit"]`)) {
      n.setAttribute('aria-busy', 'true')
      n.setAttribute('disabled', '')
      n.innerHTML = 'Check your email inbox'
    }

    // Create space
    const space = await client.createSpace(spaceName.value)

    // Create Web3Storage account
    const myAccount = await client.login(email.value as `${string}@${string}`)

    for (const n of document.querySelectorAll(`button[type="submit"]`)) {
      n.innerHTML = 'Waiting for payment plan to be selected'
    }

    while (true) {
      const res = await myAccount.plan.get()
      if (res.ok !== undefined) break
      console.log('Waiting for payment plan to be selected...')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    for (const n of document.querySelectorAll(`button[type="submit"]`)) {
      n.innerHTML = 'Provisioning space'
    }

    // Provision space
    const result = await myAccount.provision(space.did())

    console.log(result)

    await space.save()

    // Space recovery
    const recovery = await space.createRecovery(myAccount.did())
    await client.capability.access.delegate({
      space: space.did(),
      delegations: [recovery],
    })

    // Assign space DID to file system
    // → Will also trigger a sync with W3S
    await FS.Identity.assign({
      did: space.did(),
      fs,
    })

    // Enable submit button
    for (const n of document.querySelectorAll(`button[type="submit"]`)) {
      n.removeAttribute('aria-busy')
      n.removeAttribute('disabled')
      n.innerHTML = 'Store'
    }

    // Show authed-state elements
    setAuthedState('authenticated')

    // Setup device linking
    await initProvider({ client, fs })

    // Hide dialog
    hideDialog(signUpDialog)
  }
}

// 🛠️

/**
 *
 * @param dialogElement
 * @param triggerSelector
 */
function connectDialogTrigger(
  dialogElement: Element,
  triggerSelector: string
): void {
  const trigger = findElement(triggerSelector)

  trigger.addEventListener('click', () => {
    showDialog(dialogElement)
  })
}

/**
 *
 * @param selector
 * @param parent
 */
function findElement<T = HTMLElement>(
  selector: string,
  parent?: Element | HTMLElement
): T {
  const node = (parent ?? document).querySelector(selector)
  if (node === null)
    throw new Error(`Missing HTML element with selector: ${selector}`)
  return node as T
}

/**
 *
 * @param fs
 */
async function loadAndRender(fs: FileSystem): Promise<void> {
  await loadTodos(fs)
  renderTodos()
}

/**
 *
 * @param fs
 */
async function loadTodos(fs: FileSystem): Promise<void> {
  todos = (await fs.exists(TODOS_DIRECTORY))
    ? await fs.listDirectory(TODOS_DIRECTORY)
    : []
}

/**
 *
 */
function renderTodos(): void {
  const list: HTMLElement | null = document.querySelector('#list')
  if (list === null) throw new Error('Missing #list HTML element')
  list.setAttribute('aria-busy', 'false')

  if (todos.length === 0) {
    list.innerHTML = `<small><em>Nothing here yet.</em></small>`
    return
  }

  list.innerHTML = todos
    .map(
      (t) =>
        `
        <li role="group" data-todo="${t.name}">
          <h5>${t.name}</h5>
          <div style="text-align: right;"><small role="delete" data-tooltip="Delete todo">🗑️</small></div>
        </li>
        `
    )
    .join('')
}
