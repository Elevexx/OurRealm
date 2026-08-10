from copy import deepcopy

from services.game_studio import validate_spec


def valid_spec():
    return {
        "runtime": "top_down",
        "stages": [{
            "title": "Sky Harbor",
            "cores": 5,
            "pickups": [
                {"id": "coin-a", "x": 15, "y": 20,
                 "kind": "coin", "resource_amount": 2},
                {"id": "gem-a", "x": 55.5, "y": 45,
                 "kind": "gem", "resource_amount": 1},
                {"id": "star-a", "x": 88, "y": 12,
                 "kind": "star", "resource_amount": 1},
                {"id": "key-a", "x": 72, "y": 90,
                 "kind": "key", "resource_amount": 1},
            ],
        }],
    }


def test_valid_top_down_er_pickups_pass_playable_spec_validation():
    assert validate_spec(
        valid_spec(), complexity=1, expected_runtime="top_down"
    ) == []


def test_duplicate_pickup_ids_are_rejected():
    spec = valid_spec()
    spec["stages"][0]["pickups"][1]["id"] = "coin-a"
    errs = validate_spec(spec, complexity=1, expected_runtime="top_down")
    assert any("duplicate id" in err for err in errs)


def test_invalid_resource_kind_and_amount_are_rejected():
    spec = valid_spec()
    spec["stages"][0]["pickups"][0]["kind"] = "cash"
    spec["stages"][0]["pickups"][0]["resource_amount"] = 1000
    errs = validate_spec(spec, complexity=1, expected_runtime="top_down")
    assert any("unsupported resource kind" in err for err in errs)
    assert any("resource amount" in err for err in errs)


def test_missing_or_out_of_range_coordinates_are_rejected():
    spec = deepcopy(valid_spec())
    spec["stages"][0]["pickups"][0].pop("x")
    spec["stages"][0]["pickups"][1]["y"] = 101
    errs = validate_spec(spec, complexity=1, expected_runtime="top_down")
    assert any("x must be a number" in err for err in errs)
    assert any("y must be from 0 to 100" in err for err in errs)
