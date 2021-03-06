import assert from 'power-assert'
import schedule from './schedule'
import {EventEmitterMixin} from './event-emitter'
import {nop, mixin} from './utils'
import {CLOSED, ERROR} from './constants'
import {P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE, P_RESOLVED} from './constants'


// requires: implement get _isSubscribed, _subscribe(), _unsubscribe()
//
export class SpecialChan {

  constructor() {
    this._consumers = undefined
  }

  get sendOnly() {
    this._throwUnsupported('converting into a send-only chan')
  }

  get canSend() {
    return false
  }

  get canSendSync() {
    return false
  }

  _sendSync(value, type) {
    this._throwUnsupported('sending')
  }

  _send(value, type, fnVal, fnErr, needsCancelFn) {
    this._throwUnsupported('sending')
  }

  send(value) {
    this._throwUnsupported('sending')
  }

  _maybeCanSendSync(fn, mayReturnPromise) {
    if (mayReturnPromise) {
      return this.isClosed ? P_RESOLVED_WITH_FALSE : P_RESOLVED_WITH_TRUE
    } else {
      fn(!this.isClosed)
    }
  }

  _addConsumer(cons, needsCancelFn, now) {
    let consumers = this._consumers
    if (consumers) {
      consumers.push(cons)
    } else {
      this._consumers = [cons]
    }
    if (!this._isSubscribed) {
      this._subscribe(now)
    }
    return needsCancelFn ? () => this._removeConsumer(cons) : nop
  }

  _removeConsumer(cons) {
    let consumers = this._consumers
    if (!consumers) return
    let index = consumers.indexOf(cons)
    if (index >= 0) {
      consumers.splice(index, 1)
      if (consumers.length == 0 && this._isSubscribed) {
        this._unsubscribe()
      }
    }
  }

  _throwUnsupported(what) {
    let ctrName = this._desc ? this._desc.constructorName : this._constructorName
    if (typeof ctrName == 'function') ctrName = ctrName(this)
    if (ctrName == null) ctrName = this.constructor ? this.constructor.name : null
    throw new Error(`${ what } is not supported by ${ ctrName || 'unknown_chan_type' }`)
  }
}


class AlwaysActiveChanMixin {

  get isClosed() {
    return false
  }

  get isActive() {
    return true
  }

  get takeOnly() {
    return this // this chan cannot be sent to and closed per se
  }

  closeSync() {
    this._throwUnsupported('closing')
  }

  close() {
    this._throwUnsupported('closing')
  }

  closeNow() {
    this._throwUnsupported('closing')
  }
}


export class SignalChan extends SpecialChan { // mixins: AlwaysActiveChanMixin

  constructor() {
    super()
    this._value = undefined
    this._isTriggered = false
  }

  get value() {
    return this._isTriggered ? this._value : undefined
  }

  get canTakeSync() {
    return this._isTriggered
  }

  _maybeCanTakeSync(fn, mayReturnPromise) {
    if (this._isTriggered) {
      if (mayReturnPromise) {
        return P_RESOLVED_WITH_TRUE
      } else {
        fn(true)
      }
    } else {
      this._take(() => fn(true), undefined, false)
    }
  }

  takeSync() {
    return this._takeSync()
  }

  _takeSync() {
    if (!this._isTriggered) {
      return false
    }
    return this._value
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (this._isTriggered) {
      fnVal && fnVal(this._value)
      return nop
    }
    return fnVal ? this._addConsumer(fnVal, needsCancelFn) : nop
  }

  trigger(value) {
    if (!this._isTriggered) {
      this._isTriggered = true
      this._value = value
      let consumers = this._consumers
      if (!consumers) return
      this._consumers = undefined
      for (let i = 0; i < consumers.length; ++i) {
        consumers[i](value)
      }
    }
  }

  get _isSubscribed() {
    return true
  }

  _subscribe(now) {}
  _unsubscribe() {}

  get _constructorName() {
    return 'chan.signal'
  }

  get _displayFlags() {
    return this._isTriggered ? super._displayFlags + '!' : super._displayFlags
  }
}


// requires: call _initDelayChanBase(), implement _timeout()
//
class DelayChanMixin {

  _initDelayChanBase(ms) {
    this._ms = ms
    this._timeoutDate = schedule.now() + ms
    this._tid = undefined
    this._timeoutBound = () => {
      this._tid = undefined
      this._timeoutDate = 0
      this._timeout()
    }
  }

  get _isSubscribed() {
    return this._tid != undefined
  }

  _subscribe(now) {
    assert(!this._isSubscribed)
    let delay = Math.max(0, this._timeoutDate - (now || schedule.now()))
    this._tid = schedule.setTimeout(this._timeoutBound, delay)
  }

  _unsubscribe() {
    assert(this._isSubscribed)
    schedule.clearTimeout(this._tid)
    this._tid = undefined
  }
}


export class TimeoutChan extends SpecialChan { // mixins: DelayChanMixin, AlwaysActiveChanMixin

  constructor(ms, message) {
    super()
    this._initDelayChanBase(ms)
    this._message = message
  }

  get value() {
    return undefined
  }

  get canTakeSync() {
    return !this._timeoutDate || schedule.now() >= this._timeoutDate
  }

  _maybeCanTakeSync(fn, mayReturnPromise) {
    if (this.canTakeSync) {
      if (mayReturnPromise) {
        return P_RESOLVED_WITH_TRUE
      } else {
        fn(true)
      }
    } else {
      this._take(undefined, () => fn(true), false)
    }
  }

  _takeSync() {
    if (schedule.now() < this._timeoutDate) {
      return false
    }
    this._triggerNow()
    ERROR.value = this._makeError()
    return ERROR
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (!fnErr) {
      return nop
    }
    let now = schedule.now()
    if (now >= this._timeoutDate) {
      this._triggerNow()
      fnErr(this._makeError())
      return nop
    }
    return this._addConsumer(fnErr, needsCancelFn, now)
  }

  _timeout() {
    let consumers = this._consumers
    if (!consumers) return
    this._consumers = undefined
    if (consumers.length) {
      let err = this._makeError()
      for (let i = 0; i < consumers.length; ++i) {
        consumers[i](err)
      }
    }
  }

  _triggerNow() {
    if (this._isSubscribed) {
      this._unsubscribe()
      this._timeout()
      this._timeoutDate = 0
    }
  }

  _makeError() {
    return new Error(this._message || `timeout of ${ this._ms } ms exceeded`)
  }

  get _constructorName() {
    return 'chan.timeout'
  }

  get _constructorArgsDesc() {
    return this._message ? [ this._ms, this._message ] : this._ms
  }

  get _displayFlags() {
    return this.canTakeSync ? super._displayFlags + '!' : super._displayFlags
  }
}


const STATE_PENDING = 0
const STATE_FINISHED = 1
const STATE_MANUALLY_CLOSED = 2

// requires: init _state = STATE_PENDING, implement get _value, get _isError, get _isTriggered
//
class OneTimeChanMixin {

  get value() {
    return this._state == STATE_FINISHED ? this._value : undefined
  }

  get isClosed() {
    return this._state > STATE_PENDING
  }

  get isActive() {
    return this._state == STATE_PENDING
  }

  get canTakeSync() {
    return this._state == STATE_PENDING && this._isTriggered
  }

  get isManuallyClosed() {
    return this._state == STATE_MANUALLY_CLOSED
  }

  _maybeCanTakeSync(fn, mayReturnPromise) {
    if (this.canTakeSync) {
      if (mayReturnPromise) {
        return P_RESOLVED_WITH_TRUE
      } else {
        fn(true); return
      }
    }
    if (this.isClosed) {
      if (mayReturnPromise) {
        return P_RESOLVED_WITH_FALSE
      } else {
        fn(false); return
      }
    }
    this._addConsumer({ fnVal: fn, fnErr: fn, consumes: false }, false, 0)
  }

  takeSync() {
    return this._takeSync()
  }

  _takeSync() {
    if (this.canTakeSync) {
      this._close(false)
      return true
    } else {
      return false
    }
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (this.isClosed) {
      fnVal && fnVal(CLOSED)
      return nop
    }
    if (this._isTriggered) {
      this._close(false)
      let fn = this._isError ? fnErr : fnVal
      fn && fn(this._value)
      return nop
    }
    return this._addConsumer({ fnVal, fnErr, consumes: true }, needsCancelFn, 0)
  }

  closeSync() {
    if (this.isActive) {
      this._close(true)
    }
    return true
  }

  close() {
    this.closeSync()
    return P_RESOLVED
  }

  closeNow() {
    this.closeSync()
  }

  _trigger() {
    if (this._state >= STATE_FINISHED) {
      return
    }
    if (this._isSubscribed) {
      this._unsubscribe()
    }
    let consumers = this._consumers
    if (!consumers) return
    let cIndex = -1
    for (let i = 0; cIndex == -1 && i < consumers.length; ++i) {
      let item = consumers[i]
      if (item.consumes) {
        cIndex = i
      }
    }
    if (cIndex == -1) {
      consumers = consumers.splice(0)
      for (let i = 0; i < consumers.length; ++i) {
        let fn = consumers[i].fnVal
        fn && fn(true)
      }
    } else {
      let cons = consumers.splice(cIndex, 1)[0]
      let fn = this._isError ? cons.fnErr : cons.fnVal
      fn && fn(this._value)
      this._close(false)
    }
  }

  _close(manually) {
    this._state = manually ? STATE_MANUALLY_CLOSED : STATE_FINISHED
    if (this._isSubscribed) {
      this._unsubscribe()
    }
    let consumers = this._consumers
    if (!consumers) return
    while (consumers.length) {
      let cons = consumers.shift()
      cons.fnVal && cons.fnVal(cons.consumes ? CLOSED : false)
    }
  }
}


export class DelayChan extends SpecialChan { // mixins: DelayChanMixin, OneTimeChanMixin

  constructor(ms, value, isError = false) {
    super()
    this._initDelayChanBase(ms)
    this._state = STATE_PENDING
    this._value = value
    this._isError = isError
  }

  get _isTriggered() {
    return !this._timeoutDate || schedule.now() >= this._timeoutDate
  }

  _timeout() {
    this._trigger()
  }

  get _constructorName() {
    return 'chan.delay'
  }

  get _constructorArgsDesc() {
    return this._value ? [ this._ms, this._value ] : this._ms
  }

  get _displayFlags() {
    return this._isTriggered && !this.isManuallyClosed
      ? super._displayFlags + '!'
      : super._displayFlags
  }
}


export class PromiseChan extends SpecialChan { // mixins: OneTimeChanMixin

  constructor(promise) {
    super()
    this._state = STATE_PENDING
    this._value = undefined
    this._isError = false
    this._promise = promise.then(v => this._onSettled(v, false), e => this._onSettled(e, true))
  }

  get _isTriggered() {
    return !this._promise
  }

  _onSettled(value, isError) {
    this._promise = undefined
    this._value = value
    this._isError = isError
    this._trigger()
  }

  get _isSubscribed() { return !!this._promise }
  _subscribe() {}
  _unsubscribe() {}

  get _constructorName() {
    return 'chan.fromPromise'
  }

  get _constructorArgsDesc() {
    return { toString(){ return '...' } }
  }

  get _displayFlags() {
    return this._isTriggered && !this.isManuallyClosed
      ? super._displayFlags + (this._isError ? 'E' : 'v')
      : super._displayFlags
  }
}


mixin(SignalChan, AlwaysActiveChanMixin.prototype)

mixin(TimeoutChan, DelayChanMixin.prototype)
mixin(TimeoutChan, AlwaysActiveChanMixin.prototype)

mixin(DelayChan, DelayChanMixin.prototype)
mixin(DelayChan, OneTimeChanMixin.prototype)

mixin(PromiseChan, OneTimeChanMixin.prototype)
