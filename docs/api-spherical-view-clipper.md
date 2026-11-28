# Cached spherical viewport clipping

Extract cone-based clipper with configurable padded window, explicit invalidation and cull fallback. Demo retains projection and source-cap policy.

Call `createSphericalViewClipper(options)` then `clip(frame, cone, caps)`; call `clip.invalidate()` after mutations. Caps are optional, conservative, and matched by feature index.
