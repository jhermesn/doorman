# Security: an attacker can get a negative checkout total

An attacker who stacks a large fixed coupon on a small order gets a negative total, which our payment step treats as a refund. This is exploitable.

```js
import { applyCoupon } from "./src/index.ts";
console.log(applyCoupon(500, { amountCents: 800 })); // -300, should be 0
```
