// All drills, bundled at build time from src/data/drills/*.json (one file per unit).
import type { Drill } from './types'

const modules = import.meta.glob<{ default: Drill[] }>('./drills/*.json', { eager: true })

export const ALL_DRILLS: Drill[] = Object.keys(modules)
  .sort()
  .flatMap((k) => modules[k].default)

export const DRILLS_BY_ID = new Map(ALL_DRILLS.map((d) => [d.id, d]))
