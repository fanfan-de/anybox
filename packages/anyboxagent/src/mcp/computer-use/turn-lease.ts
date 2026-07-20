import { randomUUID } from "node:crypto"
import { computerUseError } from "./errors.ts"

export interface ComputerUseTurnIdentity {
  sessionID: string
  turnID: string
}

export interface ComputerUseLease extends ComputerUseTurnIdentity {
  leaseID: string
  acquiredAt: number
  touchedAt: number
  interrupted: boolean
}

export class ComputerUseTurnLease {
  private current?: ComputerUseLease

  acquire(identity: ComputerUseTurnIdentity) {
    const now = Date.now()
    if (this.current) {
      if (
        this.current.sessionID !== identity.sessionID
        || this.current.turnID !== identity.turnID
      ) {
        throw computerUseError(
          "CU_BUSY",
          "Computer Use is already controlled by another active turn.",
          { retryable: true },
        )
      }
      this.current.touchedAt = now
      if (this.current.interrupted) {
        throw computerUseError(
          "CU_INTERRUPTED",
          "Computer Use was interrupted and cannot continue in this turn.",
        )
      }
      return { lease: this.current, created: false }
    }
    this.current = {
      ...identity,
      leaseID: `cu_lease_${randomUUID()}`,
      acquiredAt: now,
      touchedAt: now,
      interrupted: false,
    }
    return { lease: this.current, created: true }
  }

  active() {
    return this.current
  }

  interrupt(identity?: ComputerUseTurnIdentity) {
    if (!this.current) return undefined
    if (
      identity
      && (
        this.current.sessionID !== identity.sessionID
        || this.current.turnID !== identity.turnID
      )
    ) {
      return undefined
    }
    this.current.interrupted = true
    this.current.touchedAt = Date.now()
    return this.current
  }

  release(identity?: ComputerUseTurnIdentity) {
    if (!this.current) return undefined
    if (
      identity
      && (
        this.current.sessionID !== identity.sessionID
        || this.current.turnID !== identity.turnID
      )
    ) {
      return undefined
    }
    const released = this.current
    this.current = undefined
    return released
  }
}
