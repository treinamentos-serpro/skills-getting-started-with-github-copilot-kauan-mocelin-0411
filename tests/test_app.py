from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

import src.app as app_module


ORIGINAL_ACTIVITIES = deepcopy(app_module.activities)
ACTIVITY_NAME = "Basketball Team"
ACTIVITY_WITH_PARTICIPANTS = "Chess Club"
STUDENT_EMAIL = "student@mergington.edu"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, "activities", deepcopy(ORIGINAL_ACTIVITIES))
    return TestClient(app_module.app)


def test_root_redirects_to_static_index(client):
    # Arrange
    expected_location = "/static/index.html"

    # Act
    response = client.get("/", follow_redirects=False)

    # Assert
    assert response.status_code == 307
    assert response.headers["location"] == expected_location


def test_get_activities_returns_all_activities(client):
    # Arrange
    expected_activities = deepcopy(ORIGINAL_ACTIVITIES)

    # Act
    response = client.get("/activities")

    # Assert
    assert response.status_code == 200
    assert response.json() == expected_activities


def test_signup_adds_student_to_activity(client):
    # Arrange
    expected_message = f"Signed up {STUDENT_EMAIL} for {ACTIVITY_NAME}"

    # Act
    response = client.post(
        f"/activities/{ACTIVITY_NAME}/signup",
        params={"email": STUDENT_EMAIL},
    )

    # Assert
    assert response.status_code == 200
    assert response.json() == {"message": expected_message}
    assert STUDENT_EMAIL in app_module.activities[ACTIVITY_NAME]["participants"]


def test_signup_returns_not_found_for_unknown_activity(client):
    # Arrange
    unknown_activity = "Unknown Club"

    # Act
    response = client.post(
        f"/activities/{unknown_activity}/signup",
        params={"email": STUDENT_EMAIL},
    )

    # Assert
    assert response.status_code == 404
    assert response.json() == {"detail": "Activity not found"}


def test_signup_returns_bad_request_for_duplicate_student(client):
    # Arrange
    existing_email = ORIGINAL_ACTIVITIES[ACTIVITY_WITH_PARTICIPANTS][
        "participants"
    ][0]

    # Act
    response = client.post(
        f"/activities/{ACTIVITY_WITH_PARTICIPANTS}/signup",
        params={"email": existing_email},
    )

    # Assert
    assert response.status_code == 400
    assert response.json() == {
        "detail": "Student already signed up for this activity"
    }


def test_unregister_removes_student_from_activity(client):
    # Arrange
    activity = app_module.activities[ACTIVITY_NAME]
    activity["participants"].append(STUDENT_EMAIL)
    expected_message = f"Unregistered {STUDENT_EMAIL} from {ACTIVITY_NAME}"

    # Act
    response = client.delete(
        f"/activities/{ACTIVITY_NAME}/signup",
        params={"email": STUDENT_EMAIL},
    )

    # Assert
    assert response.status_code == 200
    assert response.json() == {"message": expected_message}
    assert STUDENT_EMAIL not in activity["participants"]


def test_unregister_returns_not_found_for_unknown_activity(client):
    # Arrange
    unknown_activity = "Unknown Club"

    # Act
    response = client.delete(
        f"/activities/{unknown_activity}/signup",
        params={"email": STUDENT_EMAIL},
    )

    # Assert
    assert response.status_code == 404
    assert response.json() == {"detail": "Activity not found"}


def test_unregister_returns_not_found_for_unregistered_student(client):
    # Arrange
    unregistered_email = STUDENT_EMAIL

    # Act
    response = client.delete(
        f"/activities/{ACTIVITY_NAME}/signup",
        params={"email": unregistered_email},
    )

    # Assert
    assert response.status_code == 404
    assert response.json() == {
        "detail": "Student is not signed up for this activity"
    }


@pytest.mark.parametrize("method", ["post", "delete"])
def test_signup_and_unregister_require_email_query_parameter(client, method):
    # Arrange
    request = getattr(client, method)

    # Act
    response = request(f"/activities/{ACTIVITY_NAME}/signup")

    # Assert
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", "email"]
