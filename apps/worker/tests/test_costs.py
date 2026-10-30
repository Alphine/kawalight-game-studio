"""Cost control tests (FR-009, FR-022, NFR-011)."""

import pytest

from kgsm import costs
from kgsm.providers import FailingProvider, register_provider


def test_free_quote_needs_no_confirmation(store):
    q = costs.quote("mock", 4, project_id="p1")
    assert q.cents == 0
    assert q.needs_confirmation is False
    costs.authorize(q, confirmed=False)  # must not raise


def test_unknown_cost_always_needs_confirmation(store):
    register_provider(FailingProvider())
    q = costs.quote("failing", 1, project_id="p1")
    assert q.cents is None
    with pytest.raises(costs.CostError):
        costs.authorize(q, confirmed=False)


def test_batch_size_is_capped(store):
    with pytest.raises(costs.CostError):
        costs.quote("mock", 99)


def test_project_limit_blocks_spend(store):
    costs.set_limit("project:p1", 100)
    assert costs.get_limit("project:p1") == 100
    costs.record_spend(90, "test images", project_id="p1")
    assert costs.spent_this_month("p1") == 90
    costs.record_spend(20, "more images", project_id="p1")
    assert costs.spent_this_month("p1") == 110
    # Other projects are unaffected.
    assert costs.spent_this_month("p2") == 0
    costs.set_limit("project:p1", None)
    assert costs.get_limit("project:p1") is None


def test_limits_reject_negative(store):
    with pytest.raises(costs.CostError):
        costs.set_limit("global", -1)
