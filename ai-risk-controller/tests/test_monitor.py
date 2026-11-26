import asyncio
from types import SimpleNamespace

import pytest

from app.main import monitor


@pytest.mark.parametrize("fails", [False, True])
def test_monitor_persists_cycles_and_reports_failure(fails):
    async def exercise():
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()

        class Service:
            calls = 0

            def recommend(self, asset, request):
                assert asset == "NVDA"
                self.calls += 1
                loop.call_soon_threadsafe(stop.set)
                if fails:
                    raise RuntimeError("Test provider failure")

        svc = Service()
        app = SimpleNamespace(state=SimpleNamespace(service=svc, last_monitor_success=None, monitor_error=False))
        await asyncio.wait_for(monitor(app, stop, 10), timeout=5)
        assert svc.calls == 1
        assert app.state.monitor_error == fails
        assert (app.state.last_monitor_success is None) == fails

    asyncio.run(exercise())
