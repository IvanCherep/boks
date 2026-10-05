# 0009: The series shelf is the one shelf

Date: 2026-10-04
Status: accepted

The feed (`/`) stays one algorithmic stream with no picker, categories or shelves. The **series shelf** (`/series`) is the single exception: it lists only series pieces - boks produced in a reading format (cinema or immersive poem) - because only a small part of the catalogue will ever be produced that way and those pieces need a place to be found rather than waited for. Every series piece is also in the feed. The shelf must not grow into a browser for ordinary boks. Reads opened from the shelf carry `entry: "series"` in event metadata so algorithm comparisons can exclude them.
