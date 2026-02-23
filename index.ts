import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  TextContainerProperty,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import bidiFactory from 'bidi-js'
import * as ArabicReshaperModule from 'arabic-reshaper'

const DISPLAY_WIDTH = 576
const DISPLAY_HEIGHT = 288

const SEGMENT_COUNT = 3
const SEGMENT_WIDTH = DISPLAY_WIDTH / SEGMENT_COUNT
const IMAGE_HEIGHT = 100
const IMAGE_Y = 0

const WORD_GAP = 6
const FONT_SIZE = 22
const FONT = `${FONT_SIZE}px sans-serif`
const LINE_HEIGHT = 24
const MAX_VISIBLE_LINES = 3
const PADDING_TOP = 6
const PADDING_LEFT = 8
const PADDING_RIGHT = 8
const CLEAR_AFTER_IDLE_MS = 4000

const TARGET_TEXT = 'سلام'

type WordBox = {
  left: number
  right: number
}

type AppendResult = {
  added: number
  dropped: number
  touched: Set<number>
}

type RecognitionResultEventLike = Event & {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: {
      transcript: string
    }
  }>
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: RecognitionResultEventLike) => void) | null
  onerror: ((event: Event) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike

let bridge: EvenAppBridge | null = null
let streamQueue: Promise<void> = Promise.resolve()
let phraseWords: string[] = []
let translateQueue: Promise<void> = Promise.resolve()
let recognition: SpeechRecognitionLike | null = null
let micRunning = false
let clearIdleTimer: number | null = null

const OPENAI_KEY_STORAGE_KEY = 'farsi-bridge:openai-key'
const OPENAI_MODEL = 'gpt-4o-mini'

const virtualCanvas = createCanvas(DISPLAY_WIDTH, IMAGE_HEIGHT)
const virtualCtxCandidate = virtualCanvas.getContext('2d')
if (!virtualCtxCandidate) throw new Error('2D canvas not available')
const virtualCtx = virtualCtxCandidate

let cursorRightX = DISPLAY_WIDTH - PADDING_RIGHT
let lineIndex = 0

function splitWords(text: string): string[] {
  const SPACE_SEPARATORS = /[ \t\r\n\f\v\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u200B]+/
  return text
    .trim()
    .split(SPACE_SEPARATORS)
    .filter(Boolean)
}

function getReshaperFunction(): ((input: string) => string) | null {
  const moduleCandidate = ArabicReshaperModule as unknown as {
    default?: unknown
    reshape?: unknown
  }

  const defaultExport = moduleCandidate.default as
    | ((input: string) => string)
    | { reshape?: (input: string) => string }
    | undefined

  if (typeof moduleCandidate.reshape === 'function') {
    return moduleCandidate.reshape as (input: string) => string
  }
  if (typeof defaultExport === 'function') return defaultExport
  if (defaultExport && typeof defaultExport === 'object' && typeof defaultExport.reshape === 'function') {
    return defaultExport.reshape
  }
  return null
}

function shapeWord(word: string): string {
  const reshape = getReshaperFunction()
  const shaped = reshape ? reshape(word) : word

  const bidi = bidiFactory()
  bidi.getEmbeddingLevels(shaped, 'rtl')
  return shaped
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<number[]> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error('Canvas export failed'))
        return
      }
      resolve(result)
    }, 'image/png')
  })

  const buf = await blob.arrayBuffer()
  return Array.from(new Uint8Array(buf))
}

function measureWordWidth(word: string): number {
  const canvas = createCanvas(1, 1)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Math.max(16, word.length * 16)

  ctx.font = FONT
  return Math.ceil(ctx.measureText(word).width)
}

function resetFlow(): void {
  cursorRightX = DISPLAY_WIDTH - PADDING_RIGHT
  lineIndex = 0
}

function clearVirtualSurface(): void {
  virtualCtx.fillStyle = '#000000'
  virtualCtx.fillRect(0, 0, DISPLAY_WIDTH, IMAGE_HEIGHT)
  resetFlow()
}

function lineStartRight(): number {
  return DISPLAY_WIDTH - PADDING_RIGHT
}

function baselineForLine(index: number): number {
  return PADDING_TOP + FONT_SIZE + index * LINE_HEIGHT
}

function scrollSurfaceUpOneLine(): void {
  virtualCtx.drawImage(
    virtualCanvas,
    0,
    LINE_HEIGHT,
    DISPLAY_WIDTH,
    IMAGE_HEIGHT - LINE_HEIGHT,
    0,
    0,
    DISPLAY_WIDTH,
    IMAGE_HEIGHT - LINE_HEIGHT,
  )

  virtualCtx.fillStyle = '#000000'
  virtualCtx.fillRect(0, 0, DISPLAY_WIDTH, PADDING_TOP + 2)

  virtualCtx.fillStyle = '#000000'
  virtualCtx.fillRect(0, IMAGE_HEIGHT - LINE_HEIGHT, DISPLAY_WIDTH, LINE_HEIGHT)
}

function placeWord(rawWord: string): WordBox | null {
  const shaped = shapeWord(rawWord)
  const width = measureWordWidth(shaped)
  const minX = PADDING_LEFT
  const startOfLine = cursorRightX === lineStartRight()

  if (!startOfLine && cursorRightX - width < minX) {
    lineIndex += 1
    cursorRightX = lineStartRight()
  }

  if (lineIndex >= MAX_VISIBLE_LINES) {
    scrollSurfaceUpOneLine()
    lineIndex = MAX_VISIBLE_LINES - 1
  }

  let baselineY = baselineForLine(lineIndex)
  while (baselineY > IMAGE_HEIGHT - 2) {
    scrollSurfaceUpOneLine()
    lineIndex -= 1
    baselineY = baselineForLine(lineIndex)
  }

  const right = cursorRightX
  const left = Math.max(minX, right - width)

  virtualCtx.font = FONT
  virtualCtx.fillStyle = '#FFFFFF'
  virtualCtx.direction = 'rtl'
  virtualCtx.textAlign = 'right'
  virtualCtx.textBaseline = 'alphabetic'
  virtualCtx.fillText(shaped, right, baselineY)

  cursorRightX -= width + WORD_GAP

  return { left, right }
}

function touchedSegments(box: WordBox): number[] {
  const start = Math.max(0, Math.floor(box.left / SEGMENT_WIDTH))
  const end = Math.min(SEGMENT_COUNT - 1, Math.floor(Math.max(box.left, box.right - 1) / SEGMENT_WIDTH))
  const out: number[] = []
  for (let index = start; index <= end; index += 1) out.push(index)
  return out
}

async function renderSegmentBytes(segmentIndex: number): Promise<number[]> {
  const segmentCanvas = createCanvas(SEGMENT_WIDTH, IMAGE_HEIGHT)
  const ctx = segmentCanvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas not available for segment')

  const sx = segmentIndex * SEGMENT_WIDTH
  ctx.drawImage(
    virtualCanvas,
    sx,
    0,
    SEGMENT_WIDTH,
    IMAGE_HEIGHT,
    0,
    0,
    SEGMENT_WIDTH,
    IMAGE_HEIGHT,
  )

  return canvasToPngBytes(segmentCanvas)
}

async function pushBitmapToContainer(
  appBridge: EvenAppBridge,
  containerID: number,
  containerName: string,
  imageData: number[],
): Promise<void> {
  await appBridge.updateImageRawData(
    new ImageRawDataUpdate({
      containerID,
      containerName,
      imageData,
    }),
  )
}

async function updateSegments(indices: number[]): Promise<void> {
  if (!bridge) return

  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  for (const segmentIndex of sorted) {
    const bytes = await renderSegmentBytes(segmentIndex)
    await pushBitmapToContainer(
      bridge,
      2 + segmentIndex,
      `rtl-bitmap-${segmentIndex}`,
      bytes,
    )
  }
}

function queueSegmentUpdates(indices: number[]): void {
  if (!bridge) return

  streamQueue = streamQueue
    .then(() => updateSegments(indices))
    .catch((error) => {
      console.error('[farsi-bridge] stream failed', error)
      setStatus('Stream failed')
    })
}

function appendWords(incomingWords: string[]): AppendResult {
  const touched = new Set<number>()
  let added = 0
  let dropped = 0

  for (const word of incomingWords) {
    const box = placeWord(word)
    if (!box) {
      dropped += 1
      continue
    }

    phraseWords.push(word)
    added += 1

    for (const segmentIndex of touchedSegments(box)) {
      touched.add(segmentIndex)
    }
  }

  return { added, dropped, touched }
}

function setStatus(message: string): void {
  const statusEl = document.getElementById('status')
  if (statusEl) statusEl.textContent = message
}

function phraseText(): string {
  return phraseWords.join(' ')
}

function updatePreview(): void {
  const previewEl = document.getElementById('preview')
  if (!previewEl) return
  previewEl.textContent = phraseText()
}

function addWordsFromInput(rawInput: string): void {
  const incoming = splitWords(rawInput)
  if (incoming.length === 0) return

  const result = appendWords(incoming)
  scheduleIdleClear()
  updatePreview()

  if (result.touched.size > 0) {
    queueSegmentUpdates([...result.touched])
  }

  if (result.dropped > 0) {
    setStatus(`Added ${result.added} word(s), dropped ${result.dropped} (no space left)`)
    return
  }

  setStatus(`Added ${result.added} word(s)`)
}

function clearPhrase(): void {
  if (clearIdleTimer !== null) {
    window.clearTimeout(clearIdleTimer)
    clearIdleTimer = null
  }

  phraseWords = []
  clearVirtualSurface()
  updatePreview()
  queueSegmentUpdates([0, 1, 2])
  setStatus('Cleared')
}

function scheduleIdleClear(): void {
  if (clearIdleTimer !== null) {
    window.clearTimeout(clearIdleTimer)
  }

  clearIdleTimer = window.setTimeout(() => {
    clearPhrase()
  }, CLEAR_AFTER_IDLE_MS)
}

function setupWebControls(): void {
  const input = document.getElementById('wordInput') as HTMLInputElement | null
  const addButton = document.getElementById('addWordBtn') as HTMLButtonElement | null
  const clearButton = document.getElementById('clearBtn') as HTMLButtonElement | null
  const startMicButton = document.getElementById('startMicBtn') as HTMLButtonElement | null
  const stopMicButton = document.getElementById('stopMicBtn') as HTMLButtonElement | null
  const openAiKeyInput = document.getElementById('openaiKeyInput') as HTMLInputElement | null

  updatePreview()

  const savedKey = localStorage.getItem(OPENAI_KEY_STORAGE_KEY) ?? ''
  if (openAiKeyInput) openAiKeyInput.value = savedKey

  const submit = () => {
    if (!input) return
    const value = input.value
    input.value = ''
    addWordsFromInput(value)
    input.focus()
  }

  addButton?.addEventListener('click', submit)
  clearButton?.addEventListener('click', () => clearPhrase())
  startMicButton?.addEventListener('click', () => {
    void startRealtimeTranslation()
  })
  stopMicButton?.addEventListener('click', () => {
    stopRealtimeTranslation()
  })
  openAiKeyInput?.addEventListener('change', () => {
    localStorage.setItem(OPENAI_KEY_STORAGE_KEY, openAiKeyInput.value.trim())
  })
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  })
}

function getOpenAIKey(): string {
  const input = document.getElementById('openaiKeyInput') as HTMLInputElement | null
  return input?.value.trim() ?? ''
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructorLike | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructorLike
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function extractOutputText(json: unknown): string {
  const payload = json as {
    output_text?: string
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  }

  if (typeof payload.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text.trim()
  }

  const chunks = payload.output ?? []
  const collected: string[] = []

  for (const item of chunks) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        collected.push(content.text)
      }
    }
  }

  return collected.join(' ').trim()
}

async function translateEnglishToFarsi(englishText: string): Promise<string> {
  const apiKey = getOpenAIKey()
  if (!apiKey) throw new Error('OpenAI API key is missing')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content:
            'You are a real-time translator. Convert English speech text to natural Persian (Farsi). Return only Persian text with no explanations.',
        },
        {
          role: 'user',
          content: englishText,
        },
      ],
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`OpenAI translation failed: ${response.status} ${message}`)
  }

  const data = (await response.json()) as unknown
  return extractOutputText(data)
}

function enqueueTranslation(englishText: string): void {
  const trimmed = englishText.trim()
  if (!trimmed) return

  translateQueue = translateQueue
    .then(async () => {
      setStatus('Listening… translating')
      const farsi = await translateEnglishToFarsi(trimmed)
      if (!farsi) return
      addWordsFromInput(farsi)
      setStatus('Listening…')
    })
    .catch((error) => {
      console.error('[farsi-bridge] translation failed', error)
      setStatus('Translation failed')
    })
}

async function startRealtimeTranslation(): Promise<void> {
  if (micRunning) return

  const apiKey = getOpenAIKey()
  if (!apiKey) {
    setStatus('Enter OpenAI API key first')
    return
  }

  localStorage.setItem(OPENAI_KEY_STORAGE_KEY, apiKey)

  const RecognitionCtor = getSpeechRecognitionConstructor()
  if (!RecognitionCtor) {
    setStatus('SpeechRecognition not supported in this browser')
    return
  }

  recognition = new RecognitionCtor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'en-US'

  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const res = event.results[index]
      if (!res?.isFinal) continue

      const transcript = res[0]?.transcript?.trim() ?? ''
      if (transcript.length > 0) {
        enqueueTranslation(transcript)
      }
    }
  }

  recognition.onerror = () => {
    setStatus('Mic/recognition error')
  }

  recognition.onend = () => {
    if (micRunning && recognition) {
      try {
        recognition.start()
      } catch {
      }
    }
  }

  micRunning = true
  recognition.start()
  setStatus('Listening…')
}

function stopRealtimeTranslation(): void {
  micRunning = false
  if (recognition) {
    recognition.stop()
    recognition = null
  }
  setStatus('Mic stopped')
}

async function buildPage(appBridge: EvenAppBridge): Promise<void> {
  await appBridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 4,
      textObject: [
        new TextContainerProperty({
          containerID: 1,
          containerName: 'event-capture',
          content: ' ',
          xPosition: 0,
          yPosition: 0,
          width: DISPLAY_WIDTH,
          height: DISPLAY_HEIGHT,
          isEventCapture: 1,
          paddingLength: 0,
        }),
      ],
      imageObject: [
        new ImageContainerProperty({
          containerID: 2,
          containerName: 'rtl-bitmap-0',
          xPosition: 0,
          yPosition: IMAGE_Y,
          width: SEGMENT_WIDTH,
          height: IMAGE_HEIGHT,
        }),
        new ImageContainerProperty({
          containerID: 3,
          containerName: 'rtl-bitmap-1',
          xPosition: SEGMENT_WIDTH,
          yPosition: IMAGE_Y,
          width: SEGMENT_WIDTH,
          height: IMAGE_HEIGHT,
        }),
        new ImageContainerProperty({
          containerID: 4,
          containerName: 'rtl-bitmap-2',
          xPosition: SEGMENT_WIDTH * 2,
          yPosition: IMAGE_Y,
          width: SEGMENT_WIDTH,
          height: IMAGE_HEIGHT,
        }),
      ],
    }),
  )
}

async function main(): Promise<void> {
  setupWebControls()

  clearVirtualSurface()

  const seedWords = splitWords(TARGET_TEXT)
  appendWords(seedWords)
  updatePreview()

  bridge = await waitForEvenAppBridge()
  await buildPage(bridge)
  queueSegmentUpdates([0, 1, 2])
  setStatus('Connected to Even bridge')
}

void main().catch((error) => {
  console.error('[farsi-bridge] startup failed', error)
  setStatus('Startup failed')
})
