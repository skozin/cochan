# Cochan

Channel communication primitive, modelled after [golang channels]. Useful for
communication between coroutines. Plays especially well with generators or
ES7 async/await, but doesn't depend on these language features.

Supports buffering, selection from multiple channels, non-blocking operations
(`tryPut`, `tryTake` and `trySelect`), and channel closing.

Depends on Promise being available.

[golang channels]: https://tour.golang.org/concurrency/2

You can find all examples inside the [_examples](_examples) directory.
Run them by cloning this repo, doing `npm install` and then
`./run-example _examples/example_name.js` (requires Node 4 or later).


## Usage

To install from NPM:

```test
npm i -S cochan
```

Basic usage with async/await:

```js
import chan from 'cochan'

let ch = new chan()

async function producerThatRespectsBackpressure() {
  await ch.put('a')
  await ch.put('b')
  await ch.put('c')
}

function producerThatDoesntRespectBackpressure() {
  ch.put(1)
  ch.put(2)
}

async function consumer() {
  while (true) {
    let item = await ch
    if (item == ch.CLOSED) break
    console.log(`item: ${ item }`)
  }
}

producerThatRespectsBackpressure()
producerThatDoesntRespectBackpressure()
consumer()

// output: a, 1, 2, b, c
```


## Basic buffering

With ES7 async/await:

```js
import chan from 'cochan'

// allow buffering up to 3 items without blocking
let ch = new chan(3)

async function producer(items) {
  for (let item of items) {
    console.log(`[P] putting item: ${ item }...`)
    await ch.put(item)
  }
  console.log(`[P] closing channel...`)
  await ch.close()
  console.log(`[P] channel closed`)
}

async function consumer() {
  while (true) {
    let item = await ch
    if (item == ch.CLOSED) break
    console.log(`[c] got item: ${ item }`)
  }
  console.log(`[c] finished`)
}

(async function() {
  producer([ 1, 2, 3, 4, 5 ])
  await chan.delay(10)
  consumer()
})()
```

This example yields the following output:

```text
[P] putting item: 1...
[P] putting item: 2...
[P] putting item: 3...
[P] putting item: 4...
[c] got item: 1
[c] got item: 2
[c] got item: 3
[c] got item: 4
[P] putting item: 5...
[c] got item: 5
[P] closing channel...
[c] finished
[P] channel closed
```

* [The same example with generators and co](_examples/basic-gen.js)
* [The same with Promises](_examples/basic-promise.js)


## TODO

* API docs.
* More examples (select, non-blocking, wait, real-world).