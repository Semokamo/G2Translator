import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import bidiFactory from 'bidi-js'
import * as ArabicReshaperModule from 'arabic-reshaper'

const DISPLAY_WIDTH = 576
const DISPLAY_HEIGHT = 288

const SEGMENT_COUNT = 3
const SEGMENT_WIDTH = DISPLAY_WIDTH / SEGMENT_COUNT
const IMAGE_HEIGHT = 144
const IMAGE_Y = 0

const WORD_GAP = 6
const SMALL_FONT_SIZE = 15
const SMALL_LINE_HEIGHT = 22
const SMALL_MAX_VISIBLE_LINES = 4
const LARGE_FONT_SIZE = 20
const LARGE_LINE_HEIGHT = 30
const LARGE_MAX_VISIBLE_LINES = 3
const XLARGE_FONT_SIZE = 24
const XLARGE_LINE_HEIGHT = 36
const XLARGE_MAX_VISIBLE_LINES = 2
const ASSISTANT_CHAT_SMALL_FONT_SIZE = 12
const ASSISTANT_CHAT_SMALL_LINE_HEIGHT = 12
const ASSISTANT_CHAT_LARGE_FONT_SIZE = 16
const ASSISTANT_CHAT_LARGE_LINE_HEIGHT = 17
const ASSISTANT_CHAT_XLARGE_FONT_SIZE = 20
const ASSISTANT_CHAT_XLARGE_LINE_HEIGHT = 22
const CANVAS_FONT_FAMILY = '"Vazirmatn", "Noto Naskh Arabic", "Noto Nastaliq Urdu", Tahoma, sans-serif'
const PADDING_TOP = 6
const PADDING_LEFT = 8
const PADDING_RIGHT = 8
const DEFAULT_CLEAR_AFTER_IDLE_MS = 4000
const MIN_CLEAR_AFTER_IDLE_MS = 1000
const MAX_CLEAR_AFTER_IDLE_MS = 60000
const WORD_FEED_DELAY_MS = 130
const WORDS_PER_UPDATE = 2
const INTERIM_TRANSLATION_DEBOUNCE_MS = 80
const BLE_COALESCE_WINDOW_MS = 120
const BLE_MIN_UPDATE_INTERVAL_MS = 260
const MORSE_LETTER_GAP_MS = 700
const GESTURE_SEQUENCE_TIMEOUT_MS = 3200
const LTR_MARK = '\u200E'
const ACTIVITY_CONTAINER_ID = 1
const ACTIVITY_CONTAINER_NAME = 'activity-indicator'
const ACTIVITY_Y = IMAGE_HEIGHT + 6
const ACTIVITY_HEIGHT = 44
const ASSISTANT_TEXT_CONTAINER_ID = 2
const ASSISTANT_TEXT_CONTAINER_NAME = 'assistant-chat'
const ASSISTANT_ACTIVITY_HEIGHT = 32
const ASSISTANT_ACTIVITY_Y = DISPLAY_HEIGHT - ASSISTANT_ACTIVITY_HEIGHT
const ASSISTANT_TEXT_HEIGHT = ASSISTANT_ACTIVITY_Y
const ASSISTANT_KEYBOARD_ACTIVITY_Y = IMAGE_HEIGHT + 2
const ASSISTANT_KEYBOARD_ACTIVITY_HEIGHT = DISPLAY_HEIGHT - ASSISTANT_KEYBOARD_ACTIVITY_Y
const ASSISTANT_KEYBOARD_BITMAP_BASE_ID = 5

const TARGET_TEXT = ''

type WordBox = {
  left: number
  right: number
}

type WordPlacement = {
  box: WordBox
  didScroll: boolean
}

type AppendResult = {
  added: number
  dropped: number
  touched: Set<number>
}

type FontSizeMode = 'small' | 'large' | 'xlarge'
type ActivityState = 'idle' | 'listening' | 'translating'
type TargetLanguage = 'fa' | 'ar' | 'ur'
type ExperienceMode = 'translator' | 'assistant'
type PageLayout = 'translator' | 'assistant-chat' | 'assistant-keyboard'
type ChatRole = 'user' | 'assistant'
type ChatMessage = { role: ChatRole; text: string }

const MORSE_TO_CHAR: Record<string, string> = {
  '.-': 'A',
  '-...': 'B',
  '-.-.': 'C',
  '-..': 'D',
  '.': 'E',
  '..-.': 'F',
  '--.': 'G',
  '....': 'H',
  '..': 'I',
  '.---': 'J',
  '-.-': 'K',
  '.-..': 'L',
  '--': 'M',
  '-.': 'N',
  '---': 'O',
  '.--.': 'P',
  '--.-': 'Q',
  '.-.': 'R',
  '...': 'S',
  '-': 'T',
  '..-': 'U',
  '...-': 'V',
  '.--': 'W',
  '-..-': 'X',
  '-.--': 'Y',
  '--..': 'Z',
  '.----': '1',
  '..---': '2',
  '...--': '3',
  '....-': '4',
  '.....': '5',
  '-....': '6',
  '--...': '7',
  '---..': '8',
  '----.': '9',
  '-----': '0',
  '.-.-.-': '.',
  '--..--': ',',
  '-..--.': '?',
  '-.-.--': '!',
  '-....-': '-',
  '----': ' ',
}

const TARGET_LANGUAGE_CONFIG: Record<TargetLanguage, { label: string; promptName: string; micButtonSuffix: string }> = {
  fa: { label: 'Farsi (Persian)', promptName: 'Persian (Farsi)', micButtonSuffix: 'FA' },
  ar: { label: 'Arabic', promptName: 'Arabic', micButtonSuffix: 'AR' },
  ur: { label: 'Urdu', promptName: 'Urdu', micButtonSuffix: 'UR' },
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
let wordFeedQueue: Promise<void> = Promise.resolve()
let recognition: SpeechRecognitionLike | null = null
let micRunning = false
let clearIdleTimer: number | null = null
let pendingFlushTimer: number | null = null
let lastBleFlushAt = 0
const pendingSegments = new Set<number>()
let pendingResolvers: Array<() => void> = []

const TARGET_LANGUAGE_STORAGE_KEY = 'farsi-bridge:target-language'
const CLEAR_DELAY_STORAGE_KEY = 'farsi-bridge:clear-delay-ms'
const EXPERIENCE_MODE_STORAGE_KEY = 'farsi-bridge:experience-mode'
const ASSISTANT_CHAT_SESSION_STORAGE_KEY = 'farsi-bridge:assistant-chat-session'
const OPENAI_MODEL = 'gpt-4o-mini'
const OPENAI_ASSISTANT_MODEL = 'gpt-5.2-turbo'
const OPENAI_API_KEY = ''

const virtualCanvas = createCanvas(DISPLAY_WIDTH, IMAGE_HEIGHT)
const virtualCtxCandidate = virtualCanvas.getContext('2d')
if (!virtualCtxCandidate) throw new Error('2D canvas not available')
const virtualCtx = virtualCtxCandidate

let cursorRightX = DISPLAY_WIDTH - PADDING_RIGHT
let lineIndex = 0
let fontSizeMode: FontSizeMode = 'large'
let currentFontSize = LARGE_FONT_SIZE
let currentLineHeight = LARGE_LINE_HEIGHT
let currentMaxVisibleLines = LARGE_MAX_VISIBLE_LINES
let activityState: ActivityState = 'idle'
let lastSyncedActivityLabel: string | null = null
let targetLanguage: TargetLanguage = 'fa'
let experienceMode: ExperienceMode = 'translator'
let assistantKeyboardMode = false
let clearAfterIdleMs = DEFAULT_CLEAR_AFTER_IDLE_MS
let interimTranslationTimer: number | null = null
let pendingInterimTranslationText = ''
let previousInterimWords: string[] = []
let latestTranslationRequestId = 0
let morseActiveSequence = ''
let morseDecodedCurrentWord = ''
let morseCommittedText = ''
let morseLetterTimer: number | null = null
let morseWordTimer: number | null = null
let recentSwipeSequence: OsEventTypeList[] = []
let lastSwipeSequenceAt = 0
let swipeSequenceTimer: number | null = null
let assistantChatMessages: ChatMessage[] = []
let assistantScrollOffset = 0
let currentPageLayout: PageLayout | null = null
let lastSyncedAssistantText: string | null = null

function assistantWrapColumns(): number {
  if (fontSizeMode === 'xlarge') return 30
  if (fontSizeMode === 'large') return 38
  return 48
}

function assistantVisibleLines(): number {
  if (fontSizeMode === 'xlarge') return 8
  if (fontSizeMode === 'large') return 11
  return 14
}

function wrapTextByColumns(text: string, columns: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= columns) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function wrapTextByHardColumns(text: string, columns: number): string[] {
  const normalized = text.replace(/\r?\n/g, ' ')
  if (!normalized) return ['']

  const lines: string[] = []
  for (let start = 0; start < normalized.length; start += columns) {
    lines.push(normalized.slice(start, start + columns))
  }
  return lines
}

function keyboardTypingWrapColumns(): number {
  if (fontSizeMode === 'xlarge') return 26
  if (fontSizeMode === 'large') return 34
  return 44
}

function keyboardTypingVisibleLines(): number {
  if (fontSizeMode === 'xlarge') return 4
  if (fontSizeMode === 'large') return 6
  return 8
}

function morsePatternToArrows(pattern: string): string {
  return pattern.replace(/\./g, '↑').replace(/-/g, '↓')
}

function getKeyboardMorseCodeMap(): Record<string, string> {
  const mapping: Record<string, string> = { SPACE: '----' }
  for (const [pattern, value] of Object.entries(MORSE_TO_CHAR)) {
    if (value.length === 1 && /[A-Z0-9]/.test(value)) {
      mapping[value] = pattern
    }
  }
  return mapping
}

function packKeyboardTokens(tokens: string[], columns: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token
    if (candidate.length <= columns) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = token
  }

  if (current) lines.push(current)
  return lines
}

function buildKeyboardRowText(rows: string[][]): string[] {
  const codeMap = getKeyboardMorseCodeMap()
  const output: string[] = []
  const chunkSizes = [5, 5, 4]

  rows.forEach((row, rowIndex) => {
    const tokens = row.map((key) => {
      const pattern = codeMap[key] ?? ''
      const arrows = pattern ? morsePatternToArrows(pattern) : ''
      return arrows ? `${key}${arrows}` : key
    })

    const chunkSize = chunkSizes[rowIndex] ?? 4
    for (let start = 0; start < tokens.length; start += chunkSize) {
      output.push(tokens.slice(start, start + chunkSize).join(' '))
    }
  })

  return output
}

function buildAssistantChatTextContent(): string {
  const columns = assistantWrapColumns()
  const visible = assistantVisibleLines()
  const lines: string[] = []

  for (const message of assistantChatMessages) {
    const prefix = message.role === 'user' ? 'U: ' : 'A: '
    lines.push(...wrapTextByColumns(`${prefix}${message.text}`, columns))
  }

  if (lines.length === 0) {
    return 'AI CHAT\n\nNo messages yet.\nEnter keyboard mode and submit.'
  }

  const maxOffset = Math.max(0, lines.length - visible)
  assistantScrollOffset = Math.min(maxOffset, Math.max(0, assistantScrollOffset))
  const start = Math.max(0, lines.length - visible - assistantScrollOffset)
  const visibleLines = lines.slice(start, start + visible)

  return `AI CHAT\n${visibleLines.join('\n')}`
}

function buildAssistantKeyboardTextContent(): string {
  const typedLine = `${morseCommittedText}${morseDecodedCurrentWord}${morseActiveSequence}`.trim()
  const rows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ]
  const keyboardRows = buildKeyboardRowText(rows)
  const typing = typedLine ? `INPUT: ${typedLine}` : 'INPUT:'

  return [
    'KEYBOARD',
    'UP=. DOWN=-',
    'DBL=SUBMIT  UUDD=EXIT',
    'SPACE=---- DELC=UUUDDD DELW=UDUD',
    ...keyboardRows,
    typing,
  ].join('\n')
}

async function syncAssistantTextContainer(content: string): Promise<void> {
  if (!bridge) return
  if (currentPageLayout !== 'assistant-chat') return
  if (content === lastSyncedAssistantText) return
  const previousLength = lastSyncedAssistantText?.length ?? 0
  const replaceLength = Math.max(previousLength, content.length)

  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: ASSISTANT_TEXT_CONTAINER_ID,
      containerName: ASSISTANT_TEXT_CONTAINER_NAME,
      contentOffset: 0,
      contentLength: replaceLength,
      content,
    }),
  )

  lastSyncedAssistantText = content
}

function layoutForMode(mode: ExperienceMode): PageLayout {
  if (mode === 'translator') return 'translator'
  return assistantKeyboardMode ? 'assistant-keyboard' : 'assistant-chat'
}

function activeBitmapContainerName(segmentIndex: number): string {
  if (experienceMode === 'assistant' && assistantKeyboardMode) {
    return `assistant-kb-bitmap-${segmentIndex}`
  }
  return `rtl-bitmap-${segmentIndex}`
}

function activeBitmapContainerId(segmentIndex: number): number {
  if (experienceMode === 'assistant' && assistantKeyboardMode) {
    return ASSISTANT_KEYBOARD_BITMAP_BASE_ID + segmentIndex
  }
  return 2 + segmentIndex
}

async function applyPageLayout(mode: ExperienceMode, startup = false): Promise<void> {
  if (!bridge) return
  const nextLayout = layoutForMode(mode)
  if (currentPageLayout === nextLayout) return

  if (nextLayout === 'assistant-chat') {
    const page = {
      containerTotalNum: 2,
      textObject: [
        new TextContainerProperty({
          containerID: ACTIVITY_CONTAINER_ID,
          containerName: ACTIVITY_CONTAINER_NAME,
          content: ' ',
          xPosition: 0,
          yPosition: ASSISTANT_ACTIVITY_Y,
          width: DISPLAY_WIDTH,
          height: ASSISTANT_ACTIVITY_HEIGHT,
          isEventCapture: 1,
          paddingLength: 0,
        }),
        new TextContainerProperty({
          containerID: ASSISTANT_TEXT_CONTAINER_ID,
          containerName: ASSISTANT_TEXT_CONTAINER_NAME,
          content: 'AI CHAT',
          xPosition: 0,
          yPosition: IMAGE_Y,
          width: DISPLAY_WIDTH,
          height: ASSISTANT_TEXT_HEIGHT,
          isEventCapture: 0,
          paddingLength: 2,
        }),
      ],
    }

    if (startup) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
    } else {
      await bridge.rebuildPageContainer(new RebuildPageContainer(page))
    }
  } else if (nextLayout === 'assistant-keyboard') {
    const page = {
      containerTotalNum: 4,
      textObject: [
        new TextContainerProperty({
          containerID: ACTIVITY_CONTAINER_ID,
          containerName: ACTIVITY_CONTAINER_NAME,
          content: ' ',
          xPosition: 0,
          yPosition: ASSISTANT_KEYBOARD_ACTIVITY_Y,
          width: DISPLAY_WIDTH,
          height: ASSISTANT_KEYBOARD_ACTIVITY_HEIGHT,
          isEventCapture: 1,
          paddingLength: 0,
        }),
      ],
      imageObject: [
        new ImageContainerProperty({
          containerID: ASSISTANT_KEYBOARD_BITMAP_BASE_ID,
          containerName: 'assistant-kb-bitmap-0',
          xPosition: 0,
          yPosition: IMAGE_Y,
          width: SEGMENT_WIDTH,
          height: IMAGE_HEIGHT,
        }),
        new ImageContainerProperty({
          containerID: ASSISTANT_KEYBOARD_BITMAP_BASE_ID + 1,
          containerName: 'assistant-kb-bitmap-1',
          xPosition: SEGMENT_WIDTH,
          yPosition: IMAGE_Y,
          width: SEGMENT_WIDTH,
          height: IMAGE_HEIGHT,
        }),
        new ImageContainerProperty({
          containerID: ASSISTANT_KEYBOARD_BITMAP_BASE_ID + 2,
          containerName: 'assistant-kb-bitmap-2',
          xPosition: SEGMENT_WIDTH * 2,
          yPosition: IMAGE_Y,
          width: SEGMENT_WIDTH,
          height: IMAGE_HEIGHT,
        }),
      ],
    }

    if (startup) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
    } else {
      await bridge.rebuildPageContainer(new RebuildPageContainer(page))
    }
  } else {
    const page = {
      containerTotalNum: 4,
      textObject: [
        new TextContainerProperty({
          containerID: ACTIVITY_CONTAINER_ID,
          containerName: ACTIVITY_CONTAINER_NAME,
          content: ' ',
          xPosition: 0,
          yPosition: ACTIVITY_Y,
          width: DISPLAY_WIDTH,
          height: ACTIVITY_HEIGHT,
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
    }

    if (startup) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
    } else {
      await bridge.rebuildPageContainer(new RebuildPageContainer(page))
    }
  }

  currentPageLayout = nextLayout
  lastSyncedAssistantText = null
  lastSyncedActivityLabel = null
}

function persistAssistantChatSession(): void {
  try {
    sessionStorage.setItem(ASSISTANT_CHAT_SESSION_STORAGE_KEY, JSON.stringify(assistantChatMessages))
  } catch {
  }
}

function loadAssistantChatSession(): void {
  try {
    const raw = sessionStorage.getItem(ASSISTANT_CHAT_SESSION_STORAGE_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return

    assistantChatMessages = parsed
      .filter((item): item is ChatMessage => {
        if (!item || typeof item !== 'object') return false
        const candidate = item as { role?: unknown; text?: unknown }
        const isRoleValid = candidate.role === 'user' || candidate.role === 'assistant'
        const isTextValid = typeof candidate.text === 'string'
        return isRoleValid && isTextValid
      })
      .slice(-80)
  } catch {
  }
}

function currentFont(): string {
  return `${currentFontSize}px ${CANVAS_FONT_FAMILY}`
}

async function ensureRtlFontsReady(): Promise<void> {
  if (!('fonts' in document)) return

  const fonts = document.fonts
  await Promise.race([
    Promise.allSettled([
      fonts.load(`${SMALL_FONT_SIZE}px Vazirmatn`),
      fonts.load(`${LARGE_FONT_SIZE}px Vazirmatn`),
      fonts.load(`${XLARGE_FONT_SIZE}px Vazirmatn`),
      fonts.load(`${SMALL_FONT_SIZE}px Noto Naskh Arabic`),
      fonts.load(`${SMALL_FONT_SIZE}px Noto Nastaliq Urdu`),
    ]),
    sleep(1200),
  ])
}

function normalizeTargetLanguage(raw: string | null): TargetLanguage {
  if (raw === 'ar' || raw === 'ur' || raw === 'fa') return raw
  return 'fa'
}

function usesArabicShaping(language: TargetLanguage): boolean {
  return language === 'fa' || language === 'ar' || language === 'ur'
}

function splitWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
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
  const shaped = usesArabicShaping(targetLanguage) && reshape ? reshape(word) : word

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

  ctx.font = currentFont()
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
  return PADDING_TOP + currentFontSize + index * currentLineHeight
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function removeTopLineThenShiftUp(): void {
  const sourceY = PADDING_TOP + currentLineHeight
  const destinationY = PADDING_TOP
  const copyHeight = IMAGE_HEIGHT - sourceY

  const tempCanvas = createCanvas(DISPLAY_WIDTH, copyHeight)
  const tempCtx = tempCanvas.getContext('2d')
  if (!tempCtx) return

  tempCtx.drawImage(
    virtualCanvas,
    0,
    sourceY,
    DISPLAY_WIDTH,
    copyHeight,
    0,
    0,
    DISPLAY_WIDTH,
    copyHeight,
  )

  virtualCtx.fillStyle = '#000000'
  virtualCtx.fillRect(0, 0, DISPLAY_WIDTH, IMAGE_HEIGHT)
  virtualCtx.drawImage(tempCanvas, 0, destinationY)
}

function placeWord(rawWord: string): WordPlacement | null {
  const shaped = shapeWord(rawWord)
  const width = measureWordWidth(shaped)
  const minX = PADDING_LEFT
  const startOfLine = cursorRightX === lineStartRight()
  let didScroll = false

  if (!startOfLine && cursorRightX - width < minX) {
    if (lineIndex + 1 >= currentMaxVisibleLines) {
      removeTopLineThenShiftUp()
      didScroll = true
    } else {
      lineIndex += 1
    }
    cursorRightX = lineStartRight()
  }

  let baselineY = baselineForLine(lineIndex)
  while (baselineY > IMAGE_HEIGHT - 2) {
    removeTopLineThenShiftUp()
    didScroll = true
    lineIndex -= 1
    baselineY = baselineForLine(lineIndex)
  }

  const right = cursorRightX
  const left = Math.max(minX, right - width)

  virtualCtx.font = currentFont()
  virtualCtx.fillStyle = '#FFFFFF'
  virtualCtx.direction = 'rtl'
  virtualCtx.textAlign = 'right'
  virtualCtx.textBaseline = 'alphabetic'
  virtualCtx.fillText(shaped, right, baselineY)

  cursorRightX -= width + WORD_GAP

  return {
    box: { left, right },
    didScroll,
  }
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
      activeBitmapContainerId(segmentIndex),
      activeBitmapContainerName(segmentIndex),
      bytes,
    )
  }
}

function activityLabelForState(state: ActivityState): string {
  if (experienceMode === 'assistant' && assistantKeyboardMode) return ''
  if (state === 'listening') return 'Listening…'
  if (state === 'translating') return 'Translating…'
  return ''
}

function buildActivityIndicatorLabel(): string {
  const activityLabel = activityLabelForState(activityState)
  if (experienceMode !== 'assistant') return activityLabel
  if (!assistantKeyboardMode) return ''

  const typed = `${morseCommittedText}${morseDecodedCurrentWord}${morseActiveSequence}`.trim()
  if (!typed) return ''

  const wrappedLines = wrapTextByHardColumns(typed, keyboardTypingWrapColumns())
  const visibleLines = wrappedLines.slice(-keyboardTypingVisibleLines())
  const content = visibleLines.join('\n')

  if (!activityLabel) return `${LTR_MARK}${content}`
  return `${LTR_MARK}${activityLabel}\n${content}`
}

function normalizeExperienceMode(raw: string | null): ExperienceMode {
  if (raw === 'assistant' || raw === 'translator') return raw
  return 'translator'
}

function resetMorseInputState(): void {
  clearMorseTimers()
  morseActiveSequence = ''
  morseDecodedCurrentWord = ''
  morseCommittedText = ''
}

function renderTypingGuideOnVirtualSurface(): void {
  clearVirtualSurface()

  const toArrowPattern = (pattern: string): string => pattern
    .replace(/\./g, '↑')
    .replace(/-/g, '↓')

  const rows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ]

  const code: Record<string, string> = {
    A: '.-',
    B: '-...',
    C: '-.-.',
    D: '-..',
    E: '.',
    F: '..-.',
    G: '--.',
    H: '....',
    I: '..',
    J: '.---',
    K: '-.-',
    L: '.-..',
    M: '--',
    N: '-.',
    O: '---',
    P: '.--.',
    Q: '--.-',
    R: '.-.',
    S: '...',
    T: '-',
    U: '..-',
    V: '...-',
    W: '.--',
    X: '-..-',
    Y: '-.--',
    Z: '--..',
    0: '-----',
    1: '.----',
    2: '..---',
    3: '...--',
    4: '....-',
    5: '.....',
    6: '-....',
    7: '--...',
    8: '---..',
    9: '----.',
    '?': '-..--.',
    '!': '-.-.--',
    ',': '--..--',
    '.': '.-.-.-',
    '-': '-....-',
    SPACE: '----',
  }

  virtualCtx.fillStyle = '#000000'
  virtualCtx.fillRect(0, 0, DISPLAY_WIDTH, IMAGE_HEIGHT)

  const paddingX = 0
  const rowGap = 1
  const yStart = 1
  const availableHeight = IMAGE_HEIGHT - yStart * 2
  const keyHeight = Math.floor((availableHeight - (rows.length - 1) * rowGap) / rows.length)
  const letterFontSize = Math.max(12, Math.floor(keyHeight * 0.36))
  const patternFontSize = Math.max(9, Math.floor(keyHeight * 0.25))

  rows.forEach((row, rowIndex) => {
    const rowWidth = row.length
    const keyWidth = Math.floor((DISPLAY_WIDTH - paddingX * 2 - (rowWidth - 1) * rowGap) / rowWidth)
    const usedWidth = keyWidth * rowWidth + rowGap * (rowWidth - 1)
    const rowOffsetX = Math.floor((DISPLAY_WIDTH - usedWidth) / 2)
    const y = yStart + rowIndex * (keyHeight + rowGap)

    row.forEach((letter, columnIndex) => {
      const x = rowOffsetX + columnIndex * (keyWidth + rowGap)
      virtualCtx.strokeStyle = '#FFFFFF'
      virtualCtx.lineWidth = 1
      virtualCtx.strokeRect(x, y, keyWidth, keyHeight)

      virtualCtx.fillStyle = '#FFFFFF'
      virtualCtx.font = `${letterFontSize}px monospace`
      virtualCtx.textAlign = 'center'
      virtualCtx.textBaseline = 'top'
      virtualCtx.fillText(letter, x + Math.floor(keyWidth / 2), y + 2)

      virtualCtx.font = `${patternFontSize}px monospace`
      virtualCtx.fillText(toArrowPattern(code[letter] ?? ''), x + Math.floor(keyWidth / 2), y + Math.floor(keyHeight * 0.52))
    })
  })

}

function wrapLineByWords(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (virtualCtx.measureText(candidate).width <= maxWidth) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }

  if (current) lines.push(current)
  return lines
}

function renderAssistantChatOnVirtualSurface(): void {
  clearVirtualSurface()

  virtualCtx.fillStyle = '#000000'
  virtualCtx.fillRect(0, 0, DISPLAY_WIDTH, IMAGE_HEIGHT)
  virtualCtx.fillStyle = '#FFFFFF'
  virtualCtx.direction = 'ltr'
  virtualCtx.textAlign = 'left'
  virtualCtx.textBaseline = 'top'
  virtualCtx.font = '12px monospace'
  virtualCtx.fillText('AI ASSISTANT CHAT  |  up/down=scroll  |  down up down up down up=keyboard', 4, 2)

  const x = 4
  const yStart = 18
  const lineHeight = fontSizeMode === 'large'
    ? ASSISTANT_CHAT_LARGE_LINE_HEIGHT
    : fontSizeMode === 'xlarge'
      ? ASSISTANT_CHAT_XLARGE_LINE_HEIGHT
      : ASSISTANT_CHAT_SMALL_LINE_HEIGHT
  const chatFontSize = fontSizeMode === 'large'
    ? ASSISTANT_CHAT_LARGE_FONT_SIZE
    : fontSizeMode === 'xlarge'
      ? ASSISTANT_CHAT_XLARGE_FONT_SIZE
      : ASSISTANT_CHAT_SMALL_FONT_SIZE
  const maxWidth = DISPLAY_WIDTH - 8
  const maxLinesVisible = Math.floor((IMAGE_HEIGHT - yStart - 2) / lineHeight)

  virtualCtx.font = `${chatFontSize}px monospace`

  const lines: string[] = []
  for (const message of assistantChatMessages) {
    const prefix = message.role === 'user' ? 'U: ' : 'A: '
    const wrapped = wrapLineByWords(`${prefix}${message.text}`, maxWidth)
    lines.push(...wrapped)
  }

  if (lines.length === 0) {
    virtualCtx.fillText('No messages yet. Enter keyboard mode and submit to start chat.', x, yStart)
    return
  }

  const maxOffset = Math.max(0, lines.length - maxLinesVisible)
  assistantScrollOffset = Math.min(maxOffset, Math.max(0, assistantScrollOffset))
  const start = Math.max(0, lines.length - maxLinesVisible - assistantScrollOffset)
  const end = Math.min(lines.length, start + maxLinesVisible)

  let y = yStart
  for (let index = start; index < end; index += 1) {
    virtualCtx.fillText(lines[index], x, y)
    y += lineHeight
  }
}

async function renderCurrentModeTopSurface(): Promise<void> {
  if (experienceMode === 'assistant') {
    await applyPageLayout('assistant')

    if (assistantKeyboardMode) {
      renderTypingGuideOnVirtualSurface()
      await queueSegmentUpdates([0, 1, 2])
      return
    }

    const content = buildAssistantChatTextContent()
    await syncAssistantTextContainer(content)
    return
  } else {
    const existingWords = [...phraseWords]
    phraseWords = []
    clearVirtualSurface()
    appendWords(existingWords)
  }

  await queueSegmentUpdates([0, 1, 2])
}

async function scrollAssistantChat(direction: 'up' | 'down'): Promise<void> {
  if (experienceMode !== 'assistant' || assistantKeyboardMode) return
  assistantScrollOffset += direction === 'up' ? 2 : -2
  assistantScrollOffset = Math.max(0, assistantScrollOffset)
  await renderCurrentModeTopSurface()
}

async function setExperienceMode(mode: ExperienceMode): Promise<void> {
  if (mode === experienceMode) return

  if (clearIdleTimer !== null) {
    window.clearTimeout(clearIdleTimer)
    clearIdleTimer = null
  }

  experienceMode = mode
  localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, mode)
  assistantKeyboardMode = false
  clearSwipeSequenceState()

  await applyPageLayout(mode)

  if (mode === 'assistant') {
    stopRealtimeTranslation()
    resetMorseInputState()
    await renderCurrentModeTopSurface()
    setStatus('Assistant mode active')
    void syncActivityIndicator()
    return
  }

  resetMorseInputState()
  await renderCurrentModeTopSurface()
  setStatus('Translator active')
  void syncActivityIndicator()
}

function syncActivityIndicator(): Promise<void> {
  if (!bridge) return Promise.resolve()
  const label = buildActivityIndicatorLabel()
  const displayLabel = label.length > 0 ? label : ' '
  if (displayLabel === lastSyncedActivityLabel) return Promise.resolve()

  const syncedLabel = displayLabel

  return bridge
    .textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: ACTIVITY_CONTAINER_ID,
        containerName: ACTIVITY_CONTAINER_NAME,
        contentOffset: 0,
        contentLength: displayLabel.length,
        content: displayLabel,
      }),
    )
    .then(() => {
      lastSyncedActivityLabel = syncedLabel
    })
    .catch((error) => {
      console.error('[farsi-bridge] activity indicator sync failed', error)
    })
}

function setActivityState(state: ActivityState): void {
  activityState = state
  void syncActivityIndicator()
}

function refreshAssistantKeyboardSurface(): void {
  if (experienceMode !== 'assistant' || !assistantKeyboardMode) return
  void renderCurrentModeTopSurface()
}

function clearMorseTimers(): void {
  if (morseLetterTimer !== null) {
    window.clearTimeout(morseLetterTimer)
    morseLetterTimer = null
  }

  if (morseWordTimer !== null) {
    window.clearTimeout(morseWordTimer)
    morseWordTimer = null
  }
}

function decodeCurrentMorseSymbol(): void {
  if (!morseActiveSequence) return

  const decoded = MORSE_TO_CHAR[morseActiveSequence] ?? '?'
  morseCommittedText += decoded
  morseDecodedCurrentWord = ''
  morseActiveSequence = ''
  void syncActivityIndicator()
  refreshAssistantKeyboardSurface()
}

function flushMorseWordToInput(): void {
  decodeCurrentMorseSymbol()
  if (!morseCommittedText.trim()) return
  if (!morseCommittedText.endsWith(' ')) {
    morseCommittedText += ' '
  }
  void syncActivityIndicator()
  refreshAssistantKeyboardSurface()
}

function scheduleMorseCommitTimers(): void {
  if (morseLetterTimer !== null) {
    window.clearTimeout(morseLetterTimer)
  }
  if (morseWordTimer !== null) {
    window.clearTimeout(morseWordTimer)
    morseWordTimer = null
  }

  morseLetterTimer = window.setTimeout(() => {
    morseLetterTimer = null
    decodeCurrentMorseSymbol()
  }, MORSE_LETTER_GAP_MS)
}

function appendMorseSymbol(symbol: '.' | '-'): void {
  if (experienceMode !== 'assistant' || !assistantKeyboardMode) return
  morseActiveSequence += symbol
  scheduleMorseCommitTimers()
  setStatus(`Morse input: ${morseActiveSequence}`)
  void syncActivityIndicator()
  refreshAssistantKeyboardSurface()
}

function clearSwipeSequenceState(): void {
  recentSwipeSequence = []
  lastSwipeSequenceAt = 0
  if (swipeSequenceTimer !== null) {
    window.clearTimeout(swipeSequenceTimer)
    swipeSequenceTimer = null
  }
}

function scheduleSwipeSequenceTimeout(): void {
  if (swipeSequenceTimer !== null) {
    window.clearTimeout(swipeSequenceTimer)
  }

  swipeSequenceTimer = window.setTimeout(() => {
    swipeSequenceTimer = null
    recentSwipeSequence = []
    lastSwipeSequenceAt = 0
  }, GESTURE_SEQUENCE_TIMEOUT_MS)
}

function pushSwipeSequence(eventType: OsEventTypeList): void {
  const now = Date.now()
  if (now - lastSwipeSequenceAt > GESTURE_SEQUENCE_TIMEOUT_MS) {
    clearSwipeSequenceState()
  }
  lastSwipeSequenceAt = now

  recentSwipeSequence.push(eventType)
  if (recentSwipeSequence.length > 6) {
    recentSwipeSequence = recentSwipeSequence.slice(-6)
  }

  scheduleSwipeSequenceTimeout()
}

function matchesSwipeSequence(...sequence: OsEventTypeList[]): boolean {
  if (recentSwipeSequence.length < sequence.length) return false
  const start = recentSwipeSequence.length - sequence.length
  return sequence.every((item, index) => recentSwipeSequence[start + index] === item)
}

function hasSwipePrefixProgress(sequence: OsEventTypeList[]): boolean {
  const maxPrefixLength = Math.min(recentSwipeSequence.length, sequence.length - 1)
  for (let prefixLength = maxPrefixLength; prefixLength >= 1; prefixLength -= 1) {
    const start = recentSwipeSequence.length - prefixLength
    const matchesPrefix = sequence
      .slice(0, prefixLength)
      .every((item, index) => recentSwipeSequence[start + index] === item)
    if (matchesPrefix) return true
  }
  return false
}

function handleModeSwitchGesture(eventType: OsEventTypeList | undefined): boolean {
  if (eventType !== OsEventTypeList.SCROLL_TOP_EVENT && eventType !== OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    return false
  }

  pushSwipeSequence(eventType)

  const enterKeyboardSequence = [
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
  ]

  const exitKeyboardSequence = [
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
  ]

  const backspaceSequence = [
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
  ]

  const deleteWordSequence = [
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
    OsEventTypeList.SCROLL_TOP_EVENT,
    OsEventTypeList.SCROLL_BOTTOM_EVENT,
  ]

  if (experienceMode === 'assistant' && assistantKeyboardMode && matchesSwipeSequence(...exitKeyboardSequence)) {
    clearSwipeSequenceState()
    assistantKeyboardMode = false
    resetMorseInputState()
    setStatus('Assistant chat mode')
    void renderCurrentModeTopSurface()
    void syncActivityIndicator()
    return true
  }

  if (experienceMode === 'assistant' && assistantKeyboardMode && matchesSwipeSequence(...backspaceSequence)) {
    clearSwipeSequenceState()
    clearMorseTimers()
    morseActiveSequence = ''
    morseDecodedCurrentWord = ''
    removeLatestTypedCharacter()
    return true
  }

  if (experienceMode === 'assistant' && assistantKeyboardMode && matchesSwipeSequence(...deleteWordSequence)) {
    clearSwipeSequenceState()
    clearMorseTimers()
    morseActiveSequence = ''
    morseDecodedCurrentWord = ''
    removeLatestTypedWord()
    return true
  }

  if (
    experienceMode === 'assistant'
    && assistantKeyboardMode
    && (hasSwipePrefixProgress(backspaceSequence) || hasSwipePrefixProgress(deleteWordSequence))
  ) {
    return false
  }

  if (experienceMode !== 'assistant') return false

  if (assistantKeyboardMode) {
    if (!matchesSwipeSequence(...exitKeyboardSequence)) return false
  } else {
    if (!matchesSwipeSequence(...enterKeyboardSequence)) return false
  }

  clearSwipeSequenceState()

  assistantKeyboardMode = !assistantKeyboardMode
  if (!assistantKeyboardMode) {
    resetMorseInputState()
    setStatus('Assistant chat mode')
  } else {
    setStatus('Assistant keyboard mode')
  }

  void renderCurrentModeTopSurface()
  void syncActivityIndicator()
  return true
}

function submitTypingText(): void {
  decodeCurrentMorseSymbol()
  const typed = morseCommittedText.trim()
  if (!typed) {
    setStatus('Nothing to submit')
    return
  }

  if (experienceMode !== 'assistant') return

  assistantChatMessages.push({ role: 'user', text: typed })
  persistAssistantChatSession()
  assistantScrollOffset = 0

  morseCommittedText = ''
  morseDecodedCurrentWord = ''
  morseActiveSequence = ''

  assistantKeyboardMode = false
  void renderCurrentModeTopSurface()
  setStatus('Assistant thinking…')
  void syncActivityIndicator()

  void sendAssistantReply(typed)
    .then(async (reply) => {
      assistantChatMessages.push({ role: 'assistant', text: reply || 'No response.' })
      persistAssistantChatSession()
      assistantScrollOffset = 0
      await renderCurrentModeTopSurface()
      setStatus('Assistant replied')
    })
    .catch((error) => {
      console.error('[farsi-bridge] assistant request failed', error)
      assistantChatMessages.push({ role: 'assistant', text: 'Sorry, assistant request failed.' })
      persistAssistantChatSession()
      assistantScrollOffset = 0
      void renderCurrentModeTopSurface()
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Assistant failed: ${errorMessage.slice(0, 120)}`)
    })
}

function removeLatestTypedCharacter(): void {
  if (!morseCommittedText) {
    setStatus('Nothing to delete')
    return
  }

  morseCommittedText = morseCommittedText.slice(0, -1)
  setStatus('Deleted last character')
  void syncActivityIndicator()
  refreshAssistantKeyboardSurface()
}

function removeLatestTypedWord(): void {
  const trimmed = morseCommittedText.trimEnd()
  if (!trimmed) {
    setStatus('Nothing to delete')
    return
  }

  const parts = trimmed.split(/\s+/)
  parts.pop()
  morseCommittedText = parts.length > 0 ? `${parts.join(' ')} ` : ''
  setStatus('Deleted last word')
  void syncActivityIndicator()
  refreshAssistantKeyboardSurface()
}

function handleMorseGestureEvent(eventType: OsEventTypeList | undefined): void {
  if (handleModeSwitchGesture(eventType)) return
  if (experienceMode !== 'assistant') return

  if (!assistantKeyboardMode) {
    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      void scrollAssistantChat('up')
      return
    }

    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      void scrollAssistantChat('down')
      return
    }

    return
  }

  if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
    appendMorseSymbol('.')
    return
  }

  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    appendMorseSymbol('-')
    return
  }

  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (morseLetterTimer !== null) {
      window.clearTimeout(morseLetterTimer)
      morseLetterTimer = null
    }

    submitTypingText()
  }
}

function attachGestureAutoStartListener(appBridge: EvenAppBridge): void {
  appBridge.onEvenHubEvent((event) => {
    const eventTypes = [
      event.listEvent?.eventType,
      event.textEvent?.eventType,
      event.sysEvent?.eventType,
    ].filter((eventType): eventType is OsEventTypeList => eventType !== undefined)

    const uniqueEventTypes = [...new Set(eventTypes)]
    for (const eventType of uniqueEventTypes) {
      handleMorseGestureEvent(eventType)
    }
  })
}

function queueSegmentUpdates(indices: number[]): Promise<void> {
  if (!bridge) return Promise.resolve()

  for (const index of indices) {
    pendingSegments.add(index)
  }

  const completion = new Promise<void>((resolve) => {
    pendingResolvers.push(resolve)
  })

  if (pendingFlushTimer === null) {
    pendingFlushTimer = window.setTimeout(() => {
      pendingFlushTimer = null

      const segmentsToFlush = [...pendingSegments]
      pendingSegments.clear()

      const resolvers = pendingResolvers
      pendingResolvers = []

      streamQueue = streamQueue
        .then(async () => {
          const elapsed = Date.now() - lastBleFlushAt
          if (elapsed < BLE_MIN_UPDATE_INTERVAL_MS) {
            await sleep(BLE_MIN_UPDATE_INTERVAL_MS - elapsed)
          }

          await updateSegments(segmentsToFlush)
          lastBleFlushAt = Date.now()
        })
        .catch((error) => {
          console.error('[farsi-bridge] stream failed', error)
          setStatus('Stream failed')
        })
        .finally(() => {
          for (const done of resolvers) done()
        })
    }, BLE_COALESCE_WINDOW_MS)
  }

  return completion
}

function appendWords(incomingWords: string[]): AppendResult {
  const touched = new Set<number>()
  let added = 0
  let dropped = 0

  for (const word of incomingWords) {
    const placement = placeWord(word)
    if (!placement) {
      dropped += 1
      continue
    }

    phraseWords.push(word)
    added += 1

    if (placement.didScroll) {
      for (let segmentIndex = 0; segmentIndex < SEGMENT_COUNT; segmentIndex += 1) {
        touched.add(segmentIndex)
      }
    }

    for (const segmentIndex of touchedSegments(placement.box)) {
      touched.add(segmentIndex)
    }
  }

  return { added, dropped, touched }
}

function setStatus(message: string): void {
  const statusEl = document.getElementById('status')
  if (statusEl) statusEl.textContent = message
}

function clampClearDelayMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CLEAR_AFTER_IDLE_MS
  return Math.min(MAX_CLEAR_AFTER_IDLE_MS, Math.max(MIN_CLEAR_AFTER_IDLE_MS, Math.round(value)))
}

function msToSeconds(value: number): string {
  return String(Math.round(value / 1000))
}

function setMicButtonLabel(): void {
  const startMicButton = document.getElementById('startMicBtn') as HTMLButtonElement | null
  if (!startMicButton) return

  const suffix = TARGET_LANGUAGE_CONFIG[targetLanguage].micButtonSuffix
  startMicButton.textContent = `Start real-time EN→${suffix}`
}

function setFontModeLabel(): void {
  const modeEl = document.getElementById('fontModeValue')
  if (modeEl) {
    modeEl.textContent = fontSizeMode === 'xlarge'
      ? 'XL (2 lines)'
      : fontSizeMode === 'large'
        ? 'Large (3 lines)'
        : 'Small (4 lines)'
  }

  const assistantModeEl = document.getElementById('assistantFontModeValue')
  if (assistantModeEl) {
    assistantModeEl.textContent = fontSizeMode === 'xlarge'
      ? 'XL (chat)'
      : fontSizeMode === 'large'
        ? 'Large (chat)'
        : 'Small (chat)'
  }
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

  wordFeedQueue = wordFeedQueue.then(async () => {
    let added = 0
    let dropped = 0

    for (let index = 0; index < incoming.length; index += WORDS_PER_UPDATE) {
      const chunk = incoming.slice(index, index + WORDS_PER_UPDATE)
      const result = appendWords(chunk)
      added += result.added
      dropped += result.dropped

      scheduleIdleClear()
      updatePreview()

      if (result.touched.size > 0) {
        await queueSegmentUpdates([...result.touched])
      }

      if (incoming.length > WORDS_PER_UPDATE) {
        await sleep(WORD_FEED_DELAY_MS)
      }
    }

    if (dropped > 0) {
      setStatus(`Added ${added} word(s), dropped ${dropped} (no space left)`)
      return
    }

    setStatus(`Added ${added} word(s)`)
  }).catch((error) => {
    console.error('[farsi-bridge] word feed failed', error)
    setStatus('Word feed failed')
  })
}

function clearPhrase(): void {
  resetMorseInputState()

  if (clearIdleTimer !== null) {
    window.clearTimeout(clearIdleTimer)
    clearIdleTimer = null
  }

  phraseWords = []
  clearVirtualSurface()
  updatePreview()
  queueSegmentUpdates([0, 1, 2])
  void syncActivityIndicator()
  setStatus('Cleared')
}

async function setFontSizeMode(mode: FontSizeMode): Promise<void> {
  if (mode === fontSizeMode) return

  fontSizeMode = mode
  if (mode === 'xlarge') {
    currentFontSize = XLARGE_FONT_SIZE
    currentLineHeight = XLARGE_LINE_HEIGHT
    currentMaxVisibleLines = XLARGE_MAX_VISIBLE_LINES
  } else if (mode === 'large') {
    currentFontSize = LARGE_FONT_SIZE
    currentLineHeight = LARGE_LINE_HEIGHT
    currentMaxVisibleLines = LARGE_MAX_VISIBLE_LINES
  } else {
    currentFontSize = SMALL_FONT_SIZE
    currentLineHeight = SMALL_LINE_HEIGHT
    currentMaxVisibleLines = SMALL_MAX_VISIBLE_LINES
  }

  if (experienceMode === 'assistant') {
    setFontModeLabel()
    await renderCurrentModeTopSurface()
    setStatus(`Font: ${mode}`)
    return
  }

  const existingWords = [...phraseWords]
  phraseWords = []
  clearVirtualSurface()

  const result = appendWords(existingWords)
  updatePreview()
  setFontModeLabel()

  await queueSegmentUpdates([0, 1, 2])

  if (result.dropped > 0) {
    setStatus(`Font: ${mode}. Kept ${result.added}, dropped ${result.dropped}`)
    return
  }

  setStatus(`Font: ${mode}`)
}

function scheduleIdleClear(): void {
  if (experienceMode !== 'translator') return

  if (clearIdleTimer !== null) {
    window.clearTimeout(clearIdleTimer)
  }

  clearIdleTimer = window.setTimeout(() => {
    clearPhrase()
  }, clearAfterIdleMs)
}

function setupWebControls(): void {
  const input = document.getElementById('wordInput') as HTMLInputElement | null
  const addButton = document.getElementById('addWordBtn') as HTMLButtonElement | null
  const clearButton = document.getElementById('clearBtn') as HTMLButtonElement | null
  const startMicButton = document.getElementById('startMicBtn') as HTMLButtonElement | null
  const stopMicButton = document.getElementById('stopMicBtn') as HTMLButtonElement | null
  const targetLangSelect = document.getElementById('targetLangSelect') as HTMLSelectElement | null
  const experienceModeSelect = document.getElementById('experienceModeSelect') as HTMLSelectElement | null
  const idleClearSecondsInput = document.getElementById('idleClearSecondsInput') as HTMLInputElement | null
  const increaseFontButton = document.getElementById('fontIncBtn') as HTMLButtonElement | null
  const decreaseFontButton = document.getElementById('fontDecBtn') as HTMLButtonElement | null
  const extraIncreaseFontButton = document.getElementById('fontXlBtn') as HTMLButtonElement | null
  const assistantIncreaseFontButton = document.getElementById('assistantFontIncBtn') as HTMLButtonElement | null
  const assistantDecreaseFontButton = document.getElementById('assistantFontDecBtn') as HTMLButtonElement | null
  const assistantExtraIncreaseFontButton = document.getElementById('assistantFontXlBtn') as HTMLButtonElement | null
  const translatorControls = document.getElementById('translatorControls') as HTMLDivElement | null
  const assistantControls = document.getElementById('assistantControls') as HTMLDivElement | null

  const applyModeControlVisibility = (mode: ExperienceMode) => {
    if (translatorControls) translatorControls.style.display = mode === 'translator' ? 'block' : 'none'
    if (assistantControls) assistantControls.style.display = mode === 'assistant' ? 'block' : 'none'
  }

  updatePreview()
  setFontModeLabel()
  setMicButtonLabel()

  const savedLanguage = normalizeTargetLanguage(localStorage.getItem(TARGET_LANGUAGE_STORAGE_KEY))
  targetLanguage = savedLanguage
  if (targetLangSelect) targetLangSelect.value = savedLanguage
  setMicButtonLabel()

  const savedMode = normalizeExperienceMode(localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY))
  experienceMode = savedMode
  if (experienceModeSelect) experienceModeSelect.value = savedMode
  applyModeControlVisibility(savedMode)

  loadAssistantChatSession()

  const savedDelayRaw = Number(localStorage.getItem(CLEAR_DELAY_STORAGE_KEY))
  clearAfterIdleMs = clampClearDelayMs(savedDelayRaw)
  if (idleClearSecondsInput) idleClearSecondsInput.value = msToSeconds(clearAfterIdleMs)

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
    if (experienceMode !== 'translator') {
      setStatus('Switch to Translator mode to use microphone')
      return
    }
    void startRealtimeTranslation()
  })
  stopMicButton?.addEventListener('click', () => {
    stopRealtimeTranslation()
  })
  increaseFontButton?.addEventListener('click', () => {
    void setFontSizeMode('large')
  })
  extraIncreaseFontButton?.addEventListener('click', () => {
    void setFontSizeMode('xlarge')
  })
  decreaseFontButton?.addEventListener('click', () => {
    void setFontSizeMode('small')
  })
  assistantIncreaseFontButton?.addEventListener('click', () => {
    void setFontSizeMode('large')
  })
  assistantExtraIncreaseFontButton?.addEventListener('click', () => {
    void setFontSizeMode('xlarge')
  })
  assistantDecreaseFontButton?.addEventListener('click', () => {
    void setFontSizeMode('small')
  })
  experienceModeSelect?.addEventListener('change', (event) => {
    const selectEl = event.currentTarget as HTMLSelectElement | null
    const nextMode = normalizeExperienceMode(selectEl?.value ?? null)
    applyModeControlVisibility(nextMode)
    void setExperienceMode(nextMode)
  })
  targetLangSelect?.addEventListener('change', (event) => {
    const selectEl = event.currentTarget as HTMLSelectElement | null
    const selected = normalizeTargetLanguage(selectEl?.value ?? null)
    if (selected === targetLanguage) return

    targetLanguage = selected
    localStorage.setItem(TARGET_LANGUAGE_STORAGE_KEY, selected)
    setMicButtonLabel()

    const existingWords = [...phraseWords]
    phraseWords = []
    clearVirtualSurface()
    appendWords(existingWords)
    updatePreview()
    void queueSegmentUpdates([0, 1, 2])

    setStatus(`Target language: ${TARGET_LANGUAGE_CONFIG[selected].label}`)
  })
  idleClearSecondsInput?.addEventListener('change', () => {
    const parsedSeconds = Number(idleClearSecondsInput.value)
    const nextDelayMs = clampClearDelayMs(parsedSeconds * 1000)
    clearAfterIdleMs = nextDelayMs
    idleClearSecondsInput.value = msToSeconds(nextDelayMs)
    localStorage.setItem(CLEAR_DELAY_STORAGE_KEY, String(nextDelayMs))
    setStatus(`Disappear delay: ${msToSeconds(nextDelayMs)}s`)
    scheduleIdleClear()
  })
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
  })
}

function getOpenAIKey(): string {
  return OPENAI_API_KEY.trim()
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

async function translateEnglishToTargetLanguage(englishText: string, language: TargetLanguage): Promise<string> {
  const apiKey = getOpenAIKey()
  if (!apiKey) throw new Error('OpenAI API key is missing')

  const targetLanguagePromptName = TARGET_LANGUAGE_CONFIG[language].promptName

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
            `You are a real-time translator. Convert English speech text to natural ${targetLanguagePromptName}. Return only ${targetLanguagePromptName} text with no explanations.`,
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

async function sendAssistantReply(userText: string): Promise<string> {
  const apiKey = getOpenAIKey()
  if (!apiKey) throw new Error('OpenAI API key is missing')

  const conversationInput = [
    {
      role: 'system',
      content: 'You are a concise, helpful AI assistant.',
    },
    ...assistantChatMessages.map((message) => ({
      role: message.role,
      content: message.text,
    })),
  ]

  const candidateModels = [OPENAI_ASSISTANT_MODEL, OPENAI_MODEL]
  let lastErrorMessage = 'unknown assistant failure'

  for (const model of candidateModels) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: conversationInput,
        temperature: 0.4,
      }),
    })

    if (!response.ok) {
      const message = await response.text()
      lastErrorMessage = `${response.status} ${message}`
      continue
    }

    const data = (await response.json()) as unknown
    const output = extractOutputText(data)
    if (output) return output
    lastErrorMessage = 'empty assistant response'
  }

  throw new Error(`OpenAI assistant failed: ${lastErrorMessage}`)
}

function enqueueTranslation(englishText: string): void {
  const trimmed = englishText.trim()
  if (!trimmed) return
  const translationLanguage = targetLanguage
  const requestId = ++latestTranslationRequestId

  setActivityState('translating')
  setStatus(`Listening… translating to ${TARGET_LANGUAGE_CONFIG[translationLanguage].label}`)

  void translateEnglishToTargetLanguage(trimmed, translationLanguage)
    .then((translatedText) => {
      if (requestId !== latestTranslationRequestId) return
      if (!translatedText) return
      addWordsFromInput(translatedText)
      setStatus('Listening…')
      if (micRunning) setActivityState('listening')
    })
    .catch((error) => {
      if (requestId !== latestTranslationRequestId) return
      console.error('[farsi-bridge] translation failed', error)
      setStatus('Translation failed')
      if (micRunning) {
        setActivityState('listening')
      } else {
        setActivityState('idle')
      }
    })
}

function queueInterimTranslationText(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return

  pendingInterimTranslationText = pendingInterimTranslationText
    ? `${pendingInterimTranslationText} ${trimmed}`
    : trimmed

  if (interimTranslationTimer !== null) {
    window.clearTimeout(interimTranslationTimer)
  }

  interimTranslationTimer = window.setTimeout(() => {
    const payload = pendingInterimTranslationText.trim()
    pendingInterimTranslationText = ''
    interimTranslationTimer = null
    if (!payload) return
    enqueueTranslation(payload)
  }, INTERIM_TRANSLATION_DEBOUNCE_MS)
}

function flushPendingInterimTranslation(): void {
  if (interimTranslationTimer !== null) {
    window.clearTimeout(interimTranslationTimer)
    interimTranslationTimer = null
  }

  const payload = pendingInterimTranslationText.trim()
  pendingInterimTranslationText = ''
  if (!payload) return
  enqueueTranslation(payload)
}

function deltaWordsFromPrevious(previousWords: string[], transcript: string): { deltaText: string; currentWords: string[] } {
  const currentWords = splitWords(transcript)
  if (currentWords.length <= previousWords.length) {
    return { deltaText: '', currentWords }
  }

  const deltaWords = currentWords.slice(previousWords.length)
  return { deltaText: deltaWords.join(' '), currentWords }
}

function handleInterimTranscript(transcript: string): void {
  const { deltaText, currentWords } = deltaWordsFromPrevious(previousInterimWords, transcript)
  previousInterimWords = currentWords
  if (!deltaText) return
  queueInterimTranslationText(deltaText)
}

function handleFinalTranscript(transcript: string): void {
  const { deltaText } = deltaWordsFromPrevious(previousInterimWords, transcript)
  previousInterimWords = []
  flushPendingInterimTranslation()
  if (!deltaText) return
  enqueueTranslation(deltaText)
}

async function startRealtimeTranslation(): Promise<void> {
  if (micRunning) return

  const apiKey = getOpenAIKey()
  if (!apiKey) {
    setStatus('Set OPENAI_API_KEY in code first')
    return
  }

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
      const transcript = res[0]?.transcript?.trim() ?? ''
      if (transcript.length === 0) continue

      if (res?.isFinal) {
        handleFinalTranscript(transcript)
      } else {
        handleInterimTranscript(transcript)
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
  setActivityState('listening')
}

function stopRealtimeTranslation(): void {
  micRunning = false
  flushPendingInterimTranslation()
  previousInterimWords = []
  if (recognition) {
    recognition.stop()
    recognition = null
  }
  setStatus('Mic stopped')
  setActivityState('idle')
}

async function buildPage(appBridge: EvenAppBridge): Promise<void> {
  await applyPageLayout(experienceMode, true)
}

async function main(): Promise<void> {
  setupWebControls()
  await ensureRtlFontsReady()

  clearVirtualSurface()

  const seedWords = splitWords(TARGET_TEXT)
  appendWords(seedWords)
  updatePreview()

  bridge = await waitForEvenAppBridge()
  await buildPage(bridge)
  attachGestureAutoStartListener(bridge)
  await renderCurrentModeTopSurface()
  if (experienceMode === 'assistant') {
    setStatus('Assistant mode active')
  }
  await syncActivityIndicator()
  if (experienceMode === 'translator') {
    queueSegmentUpdates([0, 1, 2])
  }
  setStatus('Connected to Even bridge')
}

void main().catch((error) => {
  console.error('[farsi-bridge] startup failed', error)
  setStatus('Startup failed')
})
