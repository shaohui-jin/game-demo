/**
 * 合成音效和很轻的环境音。用振荡器现做，不依赖外部音频文件。
 * 默认关闭，在设置里打开。
 */

let ctx: AudioContext | null = null
let bgm: { osc: OscillatorNode; gain: GainNode } | null = null

function ac(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function playMerge(): void {
  const c = ac()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'triangle'
  o.frequency.setValueAtTime(480, c.currentTime)
  o.frequency.exponentialRampToValueAtTime(720, c.currentTime + 0.08)
  g.gain.setValueAtTime(0.05, c.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14)
  o.connect(g)
  g.connect(c.destination)
  o.start()
  o.stop(c.currentTime + 0.15)
}

export function setBgm(on: boolean): void {
  if (!on) {
    bgm?.osc.stop()
    bgm = null
    return
  }
  if (bgm) return
  const c = ac()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.value = 196
  g.gain.value = 0.012
  o.connect(g)
  g.connect(c.destination)
  o.start()
  bgm = { osc: o, gain: g }
}
