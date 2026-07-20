"use strict"

class SerialQueue {
  constructor() {
    this.tail = Promise.resolve()
    this.active = 0
  }

  run(operation) {
    const execute = async () => {
      this.active += 1
      try {
        return await operation()
      } finally {
        this.active -= 1
      }
    }
    const next = this.tail.then(execute, execute)
    this.tail = next.catch(() => undefined)
    return next
  }
}

module.exports = {
  SerialQueue,
}
