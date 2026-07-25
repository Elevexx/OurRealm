import asyncio

_SHARED_LOOP = None


def get_shared_loop():
    global _SHARED_LOOP
    if _SHARED_LOOP is None:
        _SHARED_LOOP = asyncio.new_event_loop()
    return _SHARED_LOOP
