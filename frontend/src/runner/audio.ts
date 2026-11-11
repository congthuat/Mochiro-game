// Fully procedural audio for Mochiro: a synthwave loop plus effects, all
// synthesised with WebAudio at runtime (no external assets, no licensing).
import { clamp } from './utils'

export type RushSfx =
  | 'jump'
  | 'land'
  | 'slide'
  | 'coin'
  | 'power'
  | 'shield'
  | 'hit'
  | 'boost'
  | 'smash'
  | 'record'
  | 'start'
  | 'gameover'
  | 'uiClick'
  | 'uiHover'

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

/** A minor pentatonic-ish bass movement, 16 steps per bar. */
const BASS_STEPS = [45, 45, 52, 45, 43, 43, 50, 43, 41, 41, 48, 41, 43, 43, 50, 52]
const CHORDS: number[][] = [
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
  [52, 55, 59],
]

export class RushAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private musicFilter: BiquadFilterNode | null = null
  private noise: AudioBuffer | null = null

  private masterVol = 0.85
  private musicVol = 0.5
  private sfxVol = 0.85

  private scheduler: number | null = null
  private step = 0
  private nextTime = 0
  private bar = 0
  private intensity = 0
  private playing = false

  get ready(): boolean {
    return this.ctx !== null
  }

  /** Must be triggered from a user gesture on most browsers. */
  async unlock(): Promise<void> {
    if (typeof window === 'undefined') return
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      this.ctx = ctx

      this.master = ctx.createGain()
      this.master.gain.value = this.masterVol
      this.master.connect(ctx.destination)

      this.musicBus = ctx.createGain()
      this.musicBus.gain.value = this.musicVol
      this.musicFilter = ctx.createBiquadFilter()
      this.musicFilter.type = 'lowpass'
      this.musicFilter.frequency.value = 1400
      this.musicFilter.Q.value = 0.7
      this.musicFilter.connect(this.musicBus)
      this.musicBus.connect(this.master)

      this.sfxBus = ctx.createGain()
      this.sfxBus.gain.value = this.sfxVol
      this.sfxBus.connect(this.master)

      // 1 second of white noise, reused by every percussive voice.
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      this.noise = buffer
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
      } catch {
        /* ignored — the game runs silently if audio stays blocked */
      }
    }
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.masterVol = clamp(master, 0, 1)
    this.musicVol = clamp(music, 0, 1)
    this.sfxVol = clamp(sfx, 0, 1)
    if (!this.ctx) return
    if (this.master) this.master.gain.value = this.masterVol
    if (this.musicBus) this.musicBus.gain.value = this.musicVol
    if (this.sfxBus) this.sfxBus.gain.value = this.sfxVol
  }

  /** 0 = standing still, 1 = top speed. Drives tempo and brightness. */
  setIntensity(value: number): void {
    const next = clamp(value, 0, 1)
    if (Math.abs(next - this.intensity) < 0.01) return
    this.intensity = next
    if (this.musicFilter && this.ctx) {
      this.musicFilter.frequency.setTargetAtTime(900 + next * 3600, this.ctx.currentTime, 0.4)
    }
  }

  startMusic(): void {
    if (!this.ctx || this.playing) return
    this.playing = true
    this.step = 0
    this.bar = 0
    this.nextTime = this.ctx.currentTime + 0.08
    this.scheduler = window.setInterval(() => this.schedule(), 25)
  }

  stopMusic(): void {
    this.playing = false
    if (this.scheduler !== null) {
      window.clearInterval(this.scheduler)
      this.scheduler = null
    }
  }

  dispose(): void {
    this.stopMusic()
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
    this.master = null
    this.musicBus = null
    this.sfxBus = null
    this.musicFilter = null
    this.noise = null
  }

  // ------------------------------------------------------------------ music --
  private schedule(): void {
    const ctx = this.ctx
    if (!ctx || !this.playing) return
    const bpm = 118 + this.intensity * 26
    const stepDur = 60 / bpm / 2 // eighth notes
    while (this.nextTime < ctx.currentTime + 0.16) {
      this.playStep(this.step, this.nextTime, stepDur)
      this.nextTime += stepDur
      this.step = (this.step + 1) % 16
      if (this.step === 0) this.bar++
    }
  }

  private playStep(step: number, time: number, stepDur: number): void {
    const busy = this.intensity > 0.25
    // Kick on the pulse.
    if (step % 4 === 0) this.kick(time)
    // Clap / snare on the backbeat.
    if (busy && (step === 4 || step === 12)) this.snare(time)
    // Hats.
    if (step % 2 === 1) this.hat(time, 0.05 + (step % 4 === 3 ? 0.03 : 0))
    if (busy && step === 14) this.hat(time + stepDur * 0.5, 0.035)

    // Bass line.
    const bassNote = BASS_STEPS[step]
    if (step % 2 === 0 || busy) this.bass(midiToFreq(bassNote), time, stepDur * (busy ? 1.7 : 2.6))

    // Pad + arp accents on bar boundaries.
    if (step === 0) {
      const chord = CHORDS[this.bar % CHORDS.length]
      this.pad(chord, time, stepDur * 16)
    }
    if (busy && (step === 2 || step === 6 || step === 10 || step === 13)) {
      const chord = CHORDS[this.bar % CHORDS.length]
      const note = chord[(step + this.bar) % chord.length] + 12
      this.pluck(midiToFreq(note), time, 0.16)
    }
  }

  private kick(time: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicFilter) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, time)
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.11)
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(0.9, time + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3)
    osc.connect(gain).connect(this.musicFilter)
    osc.start(time)
    osc.stop(time + 0.34)
  }

  private snare(time: number): void {
    const ctx = this.ctx
    if (!ctx || !this.noise || !this.musicFilter) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1900
    filter.Q.value = 0.8
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(0.34, time + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.17)
    src.connect(filter).connect(gain).connect(this.musicFilter)
    src.start(time)
    src.stop(time + 0.2)
  }

  private hat(time: number, level: number): void {
    const ctx = this.ctx
    if (!ctx || !this.noise || !this.musicFilter) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 7200
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(level, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
    src.connect(filter).connect(gain).connect(this.musicFilter)
    src.start(time)
    src.stop(time + 0.07)
  }

  private bass(freq: number, time: number, dur: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicFilter) return
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1400, time)
    filter.frequency.exponentialRampToValueAtTime(320, time + dur)
    filter.Q.value = 6
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(0.26, time + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    osc.connect(filter).connect(gain).connect(this.musicFilter)
    osc.start(time)
    osc.stop(time + dur + 0.05)
  }

  private pad(chord: number[], time: number, dur: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicFilter) return
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(0.055, time + dur * 0.35)
    gain.gain.linearRampToValueAtTime(0.0001, time + dur)
    gain.connect(this.musicFilter)
    chord.forEach((note, index) => {
      const osc = ctx.createOscillator()
      osc.type = index === 0 ? 'triangle' : 'sawtooth'
      osc.frequency.value = midiToFreq(note + 12)
      osc.detune.value = index * 6 - 6
      osc.connect(gain)
      osc.start(time)
      osc.stop(time + dur + 0.1)
    })
  }

  private pluck(freq: number, time: number, dur: number): void {
    const ctx = this.ctx
    if (!ctx || !this.musicFilter) return
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = freq
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(4200, time)
    filter.frequency.exponentialRampToValueAtTime(900, time + dur)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(0.075, time + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    osc.connect(filter).connect(gain).connect(this.musicFilter)
    osc.start(time)
    osc.stop(time + dur + 0.03)
  }

  // -------------------------------------------------------------------- sfx --
  play(name: RushSfx, param = 0): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus) return
    const t = ctx.currentTime
    switch (name) {
      case 'jump':
        this.sweep(320, 760, t, 0.16, 'triangle', 0.3)
        break
      case 'land':
        this.noiseBurst(t, 0.1, 420, 0.22)
        this.sweep(220, 90, t, 0.1, 'sine', 0.22)
        break
      case 'slide':
        this.noiseSweep(t, 0.34, 2600, 500, 0.2)
        break
      case 'coin': {
        const step = Math.min(14, Math.max(0, Math.floor(param)))
        const freq = midiToFreq(76 + step)
        this.blip(freq, t, 0.09, 'square', 0.16)
        this.blip(freq * 1.5, t + 0.045, 0.1, 'square', 0.1)
        break
      }
      case 'power':
        ;[72, 76, 79, 84].forEach((note, index) =>
          this.blip(midiToFreq(note), t + index * 0.055, 0.18, 'triangle', 0.2)
        )
        break
      case 'shield':
        this.blip(880, t, 0.22, 'sine', 0.24)
        this.blip(1320, t + 0.02, 0.2, 'sine', 0.12)
        this.noiseBurst(t, 0.16, 2400, 0.16)
        break
      case 'hit':
        this.noiseBurst(t, 0.5, 900, 0.42)
        this.sweep(180, 46, t, 0.5, 'sawtooth', 0.3)
        break
      case 'boost':
        this.sweep(260, 1500, t, 0.5, 'sawtooth', 0.24)
        this.noiseSweep(t, 0.5, 600, 4200, 0.16)
        break
      case 'smash':
        this.noiseBurst(t, 0.16, 1600, 0.26)
        this.sweep(420, 120, t, 0.16, 'square', 0.16)
        break
      case 'record':
        ;[72, 76, 79, 84].forEach((note, index) =>
          this.blip(midiToFreq(note), t + index * 0.12, 0.3, 'triangle', 0.22)
        )
        break
      case 'start':
        this.blip(midiToFreq(69), t, 0.16, 'square', 0.2)
        this.blip(midiToFreq(76), t + 0.12, 0.34, 'square', 0.22)
        break
      case 'gameover':
        this.blip(midiToFreq(64), t, 0.3, 'triangle', 0.2)
        this.blip(midiToFreq(59), t + 0.18, 0.5, 'triangle', 0.18)
        this.sweep(220, 60, t + 0.1, 0.7, 'sawtooth', 0.14)
        break
      case 'uiClick':
        this.blip(1180, t, 0.05, 'square', 0.1)
        break
      case 'uiHover':
        this.blip(880, t, 0.03, 'sine', 0.05)
        break
      default:
        break
    }
  }

  private blip(freq: number, time: number, dur: number, type: OscillatorType, level: number): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(level, time + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    osc.connect(gain).connect(this.sfxBus)
    osc.start(time)
    osc.stop(time + dur + 0.02)
  }

  private sweep(from: number, to: number, time: number, dur: number, type: OscillatorType, level: number): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, time)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), time + dur)
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(level, time + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    osc.connect(gain).connect(this.sfxBus)
    osc.start(time)
    osc.stop(time + dur + 0.02)
  }

  private noiseBurst(time: number, dur: number, freq: number, level: number): void {
    const ctx = this.ctx
    if (!ctx || !this.noise || !this.sfxBus) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    filter.Q.value = 0.7
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(level, time)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    src.connect(filter).connect(gain).connect(this.sfxBus)
    src.start(time)
    src.stop(time + dur + 0.02)
  }

  private noiseSweep(time: number, dur: number, from: number, to: number, level: number): void {
    const ctx = this.ctx
    if (!ctx || !this.noise || !this.sfxBus) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 1.4
    filter.frequency.setValueAtTime(from, time)
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), time + dur)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(level, time + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    src.connect(filter).connect(gain).connect(this.sfxBus)
    src.start(time)
    src.stop(time + dur + 0.02)
  }
}
