// Fully procedural audio: ambient score + sound effects synthesised with WebAudio.
// No external assets — everything is generated at runtime, so it ships licence-free.

export type SfxName =
  | 'jump'
  | 'land'
  | 'step'
  | 'collect'
  | 'orb'
  | 'attack'
  | 'hit'
  | 'enemyDie'
  | 'hurt'
  | 'dash'
  | 'portal'
  | 'zoneClear'
  | 'victory'
  | 'defeat'
  | 'upgrade'
  | 'uiClick'
  | 'uiHover'
  | 'roar'
  | 'telegraph'
  | 'explode'

export interface MusicConfig {
  root: number
  scale: number[]
  tempo: number
  mood: 'calm' | 'tense' | 'dark' | 'heroic'
}

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null

  private masterVol = 0.85
  private musicVol = 0.55
  private sfxVol = 0.8
  private muted = false

  private schedulerId: number | null = null
  private nextNoteTime = 0
  private stepIndex = 0
  private music: MusicConfig | null = null
  private intensity = 0

  private lastStepAt = 0

  get ready(): boolean {
    return this.ctx !== null
  }

  /** Must be called from a user gesture (button click) before anything plays. */
  unlock(): void {
    if (typeof window === 'undefined') return
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    if (!this.ctx) {
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.musicBus = this.ctx.createGain()
      this.sfxBus = this.ctx.createGain()
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 3
      this.musicBus.connect(this.master)
      this.sfxBus.connect(this.master)
      this.master.connect(comp)
      comp.connect(this.ctx.destination)
      this.applyVolumes()
      this.noiseBuffer = this.buildNoise(this.ctx)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private buildNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.5)
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = 0.98 * last + 0.02 * white
      data[i] = last * 3.2
    }
    return buffer
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.masterVol = master
    this.musicVol = music
    this.sfxVol = sfx
    this.applyVolumes()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.musicBus || !this.sfxBus) return
    const now = this.ctx.currentTime
    const mute = this.muted ? 0 : 1
    this.master.gain.setTargetAtTime(this.masterVol * mute, now, 0.05)
    this.musicBus.gain.setTargetAtTime(this.musicVol * 0.5, now, 0.08)
    this.sfxBus.gain.setTargetAtTime(this.sfxVol * 0.85, now, 0.05)
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value))
  }

  // ---------------------------------------------------------------- music ---

  playMusic(config: MusicConfig): void {
    this.music = config
    if (!this.ctx) return
    this.stopMusic()
    this.stepIndex = 0
    this.nextNoteTime = this.ctx.currentTime + 0.15
    this.schedulerId = window.setInterval(() => this.schedule(), 25)
  }

  stopMusic(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId)
      this.schedulerId = null
    }
  }

  private schedule(): void {
    const ctx = this.ctx
    const music = this.music
    if (!ctx || !music) return
    const beat = 60 / music.tempo
    const stepDur = beat / 2
    while (this.nextNoteTime < ctx.currentTime + 0.25) {
      this.playStep(this.stepIndex, this.nextNoteTime, music, stepDur)
      this.stepIndex++
      this.nextNoteTime += stepDur
    }
  }

  private playStep(step: number, time: number, music: MusicConfig, stepDur: number): void {
    const bar = Math.floor(step / 8) % 4
    const inBar = step % 8
    const progression = [0, 3, 4, 2]
    const degree = progression[bar]
    const scale = music.scale
    const noteAt = (deg: number, octave = 0): number => {
      const idx = ((deg % scale.length) + scale.length) % scale.length
      const oct = Math.floor(deg / scale.length) + octave
      return music.root + scale[idx] + oct * 12
    }

    // Pad chord at the start of each bar.
    if (inBar === 0) {
      const chord = [0, 2, 4].map((d) => noteAt(degree + d))
      chord.forEach((note, i) => {
        this.padVoice(time, midiToFreq(note + 12), 4.2, 0.1 - i * 0.015)
        this.padVoice(time + 0.02, midiToFreq(note + 12) * 1.005, 4.2, 0.06)
      })
      if (music.mood === 'dark' || music.mood === 'heroic') {
        this.padVoice(time, midiToFreq(noteAt(degree) - 12), 4.4, 0.14, 'sawtooth')
      }
    }

    // Bass pulse.
    if (inBar === 0 || inBar === 4) {
      this.tone({
        time,
        freq: midiToFreq(noteAt(degree) - 24),
        type: 'sine',
        dur: stepDur * 2.6,
        gain: 0.16,
        attack: 0.02,
        release: 0.5,
        bus: 'music',
      })
    }

    // Melodic arpeggio — density grows with combat intensity.
    const arpChance = 0.35 + this.intensity * 0.5
    if (step % 2 === 1 || Math.random() < arpChance) {
      const deg = degree + [0, 2, 4, 5, 7][Math.floor(Math.random() * 5)]
      const octave = Math.random() < 0.35 ? 1 : 0
      this.bellVoice(time, midiToFreq(noteAt(deg, octave) + 12), 1.4, 0.055 + this.intensity * 0.03)
    }

    // Soft percussion when things heat up.
    if (this.intensity > 0.25) {
      if (inBar === 0 || inBar === 4) this.kick(time, 0.22 + this.intensity * 0.16)
      if (inBar % 2 === 1) this.hat(time, 0.035 + this.intensity * 0.03)
    }
  }

  private padVoice(time: number, freq: number, dur: number, gain: number, type: OscillatorType = 'triangle'): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus) return
    const osc = ctx.createOscillator()
    const filter = ctx.createBiquadFilter()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    filter.type = 'lowpass'
    filter.frequency.value = 900
    filter.Q.value = 0.6
    amp.gain.setValueAtTime(0.0001, time)
    amp.gain.linearRampToValueAtTime(gain, time + 0.9)
    amp.gain.linearRampToValueAtTime(0.0001, time + dur)
    osc.connect(filter)
    filter.connect(amp)
    amp.connect(this.musicBus)
    osc.start(time)
    osc.stop(time + dur + 0.1)
  }

  private bellVoice(time: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus) return
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    amp.gain.setValueAtTime(0.0001, time)
    amp.gain.linearRampToValueAtTime(gain, time + 0.01)
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    osc.connect(amp)
    amp.connect(this.musicBus)
    osc.start(time)
    osc.stop(time + dur + 0.05)
  }

  private kick(time: number, gain: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus) return
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(120, time)
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.16)
    amp.gain.setValueAtTime(gain, time)
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.24)
    osc.connect(amp)
    amp.connect(this.musicBus)
    osc.start(time)
    osc.stop(time + 0.3)
  }

  private hat(time: number, gain: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicBus || !this.noiseBuffer) return
    const src = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const amp = ctx.createGain()
    src.buffer = this.noiseBuffer
    filter.type = 'highpass'
    filter.frequency.value = 7000
    amp.gain.setValueAtTime(gain, time)
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.06)
    src.connect(filter)
    filter.connect(amp)
    amp.connect(this.musicBus)
    src.start(time)
    src.stop(time + 0.1)
  }

  // ------------------------------------------------------------------ sfx ---

  private tone(opts: {
    time?: number
    freq: number
    freqEnd?: number
    type?: OscillatorType
    dur: number
    gain: number
    attack?: number
    release?: number
    bus?: 'sfx' | 'music'
    detune?: number
  }): void {
    const ctx = this.ctx
    const bus = opts.bus === 'music' ? this.musicBus : this.sfxBus
    if (!ctx || !bus) return
    const time = opts.time ?? ctx.currentTime
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(opts.freq, time)
    if (opts.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), time + opts.dur)
    }
    if (opts.detune) osc.detune.value = opts.detune
    const attack = opts.attack ?? 0.006
    amp.gain.setValueAtTime(0.0001, time)
    amp.gain.linearRampToValueAtTime(opts.gain, time + attack)
    amp.gain.exponentialRampToValueAtTime(0.0001, time + opts.dur)
    osc.connect(amp)
    amp.connect(bus)
    osc.start(time)
    osc.stop(time + opts.dur + (opts.release ?? 0.05))
  }

  private noise(opts: {
    time?: number
    dur: number
    gain: number
    type?: BiquadFilterType
    freq: number
    freqEnd?: number
    q?: number
  }): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return
    const time = opts.time ?? ctx.currentTime
    const src = ctx.createBufferSource()
    const filter = ctx.createBiquadFilter()
    const amp = ctx.createGain()
    src.buffer = this.noiseBuffer
    filter.type = opts.type ?? 'bandpass'
    filter.frequency.setValueAtTime(opts.freq, time)
    if (opts.freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), time + opts.dur)
    }
    filter.Q.value = opts.q ?? 1.1
    amp.gain.setValueAtTime(0.0001, time)
    amp.gain.linearRampToValueAtTime(opts.gain, time + 0.008)
    amp.gain.exponentialRampToValueAtTime(0.0001, time + opts.dur)
    src.connect(filter)
    filter.connect(amp)
    amp.connect(this.sfxBus)
    src.start(time)
    src.stop(time + opts.dur + 0.05)
  }

  play(name: SfxName): void {
    const ctx = this.ctx
    if (!ctx || this.muted) return
    const t = ctx.currentTime
    switch (name) {
      case 'jump':
        this.tone({ freq: 320, freqEnd: 720, type: 'triangle', dur: 0.22, gain: 0.2 })
        this.noise({ dur: 0.16, gain: 0.05, freq: 900, freqEnd: 2600 })
        break
      case 'land':
        this.tone({ freq: 180, freqEnd: 70, type: 'sine', dur: 0.2, gain: 0.26 })
        this.noise({ dur: 0.16, gain: 0.09, freq: 500, freqEnd: 160, type: 'lowpass' })
        break
      case 'step':
        this.noise({ dur: 0.09, gain: 0.055, freq: 320, freqEnd: 180, type: 'lowpass', q: 0.7 })
        break
      case 'collect':
        this.tone({ freq: 880, type: 'sine', dur: 0.2, gain: 0.16 })
        this.tone({ time: t + 0.07, freq: 1320, type: 'sine', dur: 0.28, gain: 0.13 })
        this.tone({ time: t + 0.14, freq: 1760, type: 'sine', dur: 0.32, gain: 0.09 })
        break
      case 'orb':
        this.tone({ freq: 520, freqEnd: 780, type: 'triangle', dur: 0.32, gain: 0.17 })
        this.tone({ time: t + 0.08, freq: 1040, type: 'sine', dur: 0.3, gain: 0.1 })
        break
      case 'attack':
        this.noise({ dur: 0.24, gain: 0.16, freq: 1800, freqEnd: 260, q: 0.8 })
        this.tone({ freq: 240, freqEnd: 90, type: 'square', dur: 0.16, gain: 0.1 })
        break
      case 'hit':
        this.noise({ dur: 0.12, gain: 0.16, freq: 2400, freqEnd: 700, q: 0.9 })
        this.tone({ freq: 420, freqEnd: 150, type: 'square', dur: 0.12, gain: 0.12 })
        break
      case 'enemyDie':
        this.tone({ freq: 660, freqEnd: 120, type: 'sawtooth', dur: 0.42, gain: 0.16 })
        this.noise({ dur: 0.4, gain: 0.1, freq: 1400, freqEnd: 200, q: 0.7 })
        break
      case 'hurt':
        this.tone({ freq: 220, freqEnd: 60, type: 'sawtooth', dur: 0.4, gain: 0.22 })
        this.noise({ dur: 0.3, gain: 0.12, freq: 700, freqEnd: 120, type: 'lowpass' })
        break
      case 'dash':
        this.noise({ dur: 0.28, gain: 0.14, freq: 400, freqEnd: 2600, q: 0.6 })
        break
      case 'portal':
        this.tone({ freq: 220, freqEnd: 660, type: 'triangle', dur: 1.2, gain: 0.18 })
        this.tone({ time: t + 0.1, freq: 330, freqEnd: 990, type: 'sine', dur: 1.1, gain: 0.12 })
        break
      case 'zoneClear':
        ;[0, 4, 7, 12].forEach((semi, i) => {
          this.tone({
            time: t + i * 0.11,
            freq: midiToFreq(69 + semi),
            type: 'triangle',
            dur: 0.5,
            gain: 0.15,
          })
        })
        break
      case 'upgrade':
        ;[0, 7, 12, 19].forEach((semi, i) => {
          this.tone({
            time: t + i * 0.08,
            freq: midiToFreq(64 + semi),
            type: 'sine',
            dur: 0.7,
            gain: 0.13,
          })
        })
        break
      case 'victory':
        ;[0, 4, 7, 12, 16, 19, 24].forEach((semi, i) => {
          this.tone({
            time: t + i * 0.16,
            freq: midiToFreq(57 + semi),
            type: 'triangle',
            dur: 1.1,
            gain: 0.16,
          })
          this.tone({
            time: t + i * 0.16,
            freq: midiToFreq(57 + semi) * 1.5,
            type: 'sine',
            dur: 1.0,
            gain: 0.07,
          })
        })
        break
      case 'defeat':
        ;[0, -3, -7, -12].forEach((semi, i) => {
          this.tone({
            time: t + i * 0.3,
            freq: midiToFreq(57 + semi),
            type: 'sawtooth',
            dur: 1.3,
            gain: 0.13,
          })
        })
        break
      case 'roar':
        this.tone({ freq: 90, freqEnd: 46, type: 'sawtooth', dur: 1.5, gain: 0.3 })
        this.noise({ dur: 1.4, gain: 0.18, freq: 320, freqEnd: 90, type: 'lowpass', q: 0.8 })
        break
      case 'telegraph':
        this.tone({ freq: 700, freqEnd: 1300, type: 'triangle', dur: 0.5, gain: 0.12 })
        break
      case 'explode':
        this.noise({ dur: 0.7, gain: 0.26, freq: 1200, freqEnd: 80, type: 'lowpass', q: 0.6 })
        this.tone({ freq: 160, freqEnd: 40, type: 'sine', dur: 0.6, gain: 0.24 })
        break
      case 'uiClick':
        this.tone({ freq: 620, type: 'triangle', dur: 0.1, gain: 0.1 })
        this.tone({ time: t + 0.04, freq: 930, type: 'sine', dur: 0.12, gain: 0.07 })
        break
      case 'uiHover':
        this.tone({ freq: 880, type: 'sine', dur: 0.06, gain: 0.045 })
        break
      default:
        break
    }
  }

  dispose(): void {
    this.stopMusic()
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined)
    }
    this.ctx = null
    this.master = null
    this.musicBus = null
    this.sfxBus = null
    this.noiseBuffer = null
  }
}
