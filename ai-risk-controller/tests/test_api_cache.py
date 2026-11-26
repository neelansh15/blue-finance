from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest

from app.agents.issuer_agent import OpenAICompatibleProvider
from app.integrations.cache import ApiCache
from app.integrations.providers import MockProviders, DEMO_TIMES


def test_success_expiry_input_isolation_and_bounded_cache():
    now, calls = [0], []
    cache = ApiCache(clock=lambda: now[0], max_entries=2)
    def load():
        calls.append(1)
        return 'ok'
    assert cache.get('a', load) == 'ok'
    now[0] = 59.999
    cache.get('a', load)
    assert len(calls) == 1
    cache.get('b', load)
    now[0] = 60
    cache.get('a', load)
    assert len(calls) == 3
    cache.get('c', load)
    assert len(cache.entries) == 2
    now[0] = 0
    cache.get('c', load)
    assert len(calls) == 5


def test_failures_cached_no_stale_fallback_and_retry_after_expiry():
    now, calls = [0], []
    cache = ApiCache(clock=lambda: now[0])
    cache.get('a', lambda: 'old')
    def fail():
        calls.append(1)
        raise ValueError('private provider body')
    for at in [60, 119.999]:
        now[0] = at
        with pytest.raises(RuntimeError, match='External API request unavailable') as error:
            cache.get('a', fail)
        assert 'private' not in str(error.value)
    assert len(calls) == 1
    now[0] = 120
    assert cache.get('a', lambda: 'recovered') == 'recovered'


def test_concurrent_requests_share_one_upstream_call():
    started, finish, calls = Event(), Event(), []
    cache = ApiCache()
    def load():
        calls.append(1)
        started.set()
        assert finish.wait(5)
        return 'ok'
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(cache.get, 'same', load)
        assert started.wait(5)
        second = pool.submit(cache.get, 'same', load)
        finish.set()
        assert first.result() == second.result() == 'ok'
    assert len(calls) == 1


def test_llm_caches_exact_evidence_and_separates_changed_documents(monkeypatch):
    calls = []
    real_client = httpx.Client
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'choices': [{'message': {'content': '{"events":[]}'}}]})
    monkeypatch.setattr('app.agents.issuer_agent.httpx.Client', lambda **kwargs:
                        real_client(transport=httpx.MockTransport(handler), **kwargs))
    provider = OpenAICompatibleProvider('https://llm.test/v1', 'test-placeholder', 'model')
    now = [0]
    provider._cache.clock = lambda: now[0]
    docs = MockProviders().documents(DEMO_TIMES['baseline'], 'baseline')
    provider.extract('NVDA', docs)
    now[0] = 59.999
    provider.extract('NVDA', docs)
    assert len(calls) == 1
    provider.extract('TSLA', docs)
    docs[0].text += ' Changed evidence.'
    provider.extract('NVDA', docs)
    assert len(calls) == 3
    now[0] = 60
    provider.extract('NVDA', MockProviders().documents(DEMO_TIMES['baseline'], 'baseline'))
    assert len(calls) == 4
