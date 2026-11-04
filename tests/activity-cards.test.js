const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appScript = fs.readFileSync(
  path.join(__dirname, "../src/static/app.js"),
  "utf8"
);

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = "";
    this.value = "";
    this.listeners = {};
    this._innerHTML = "";
    this._textContent = "";
    this.classList = {
      add: (name) => {
        this.className = [...new Set([...this.className.split(" ").filter(Boolean), name])].join(" ");
      },
      remove: (name) => {
        this.className = this.className.split(" ").filter((item) => item !== name).join(" ");
      },
    };
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this._textContent = "";
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = "";
    this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this[name] = value;
  }
}

class SelectElement extends Element {
  get options() {
    return this.children;
  }

  remove(index) {
    this.children.splice(index, 1);
    if (!this.options.some((option) => option.value === this.value)) {
      this.value = "";
    }
  }
}

function activityData() {
  return {
    "Chess Club": {
      description: "Play chess",
      schedule: "Fridays",
      max_participants: 5,
      participants: ["michael@mergington.edu", "daniel@mergington.edu"],
    },
    "Art Club": {
      description: "Make art",
      schedule: "Wednesdays",
      max_participants: 5,
      participants: [],
    },
  };
}

function response(status, body) {
  const snapshot = JSON.parse(JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => snapshot,
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function createApp(activities = activityData(), initialStatus = 200) {
  const elements = {
    "activities-list": new Element("div"),
    activity: new SelectElement("select"),
    "signup-form": new Element("form"),
    message: new Element("div"),
    email: new Element("input"),
  };
  const placeholder = new Element("option");
  placeholder.value = "";
  elements.activity.appendChild(placeholder);
  elements.message.className = "hidden";
  elements["signup-form"].reset = () => {
    elements.email.value = "";
    elements.activity.value = "";
  };

  const state = {
    activities,
    nextActivitiesStatus: initialStatus,
    delayActivities: false,
    pendingActivities: [],
    requests: [],
    errors: [],
  };

  async function fetch(url, options = {}) {
    const method = options.method || "GET";
    state.requests.push({ url, method });

    if (url === "/activities") {
      const status = state.nextActivitiesStatus;
      state.nextActivitiesStatus = 200;
      const result = response(status, state.activities);
      if (state.delayActivities) {
        return new Promise((resolve) => {
          state.pendingActivities.push(() => resolve(result));
        });
      }
      return result;
    }

    const requestUrl = new URL(url, "http://example.test");
    const activityName = decodeURIComponent(
      requestUrl.pathname.slice("/activities/".length, -"/signup".length)
    );
    const email = requestUrl.searchParams.get("email");
    const activity = state.activities[activityName];
    if (!activity) {
      return response(404, { detail: "Activity not found" });
    }
    if (method === "DELETE") {
      const participantIndex = activity.participants.indexOf(email);
      if (participantIndex === -1) {
        return response(404, { detail: "Student is not signed up for this activity" });
      }
      activity.participants.splice(participantIndex, 1);
      return response(200, { message: `Unregistered ${email} from ${activityName}` });
    }
    if (activity.participants.includes(email)) {
      return response(400, { detail: "Student already signed up for this activity" });
    }
    activity.participants.push(email);
    return response(200, { message: `Signed up ${email} for ${activityName}` });
  }

  const document = {
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    createElement(tagName) {
      return new Element(tagName);
    },
    getElementById(id) {
      return elements[id];
    },
  };

  vm.runInNewContext(appScript, {
    document,
    fetch,
    console: { error: (...args) => state.errors.push(args) },
    setTimeout: () => {},
  });
  document.listeners.DOMContentLoaded();
  await flush();

  return {
    elements,
    state,
    submit(email, activity) {
      elements.email.value = email;
      elements.activity.value = activity;
      return elements["signup-form"].listeners.submit({ preventDefault() {} });
    },
  };
}

function participantSection(card) {
  return card.children.find((child) => child.className === "activity-participants");
}

function participantItems(card) {
  const list = participantSection(card).children.find((child) => child.tagName === "UL");
  return list ? list.children : [];
}

function participantNames(card) {
  return participantItems(card).map((item) => item.children[0].textContent);
}

test("renders participants as list items and explains empty activities", async () => {
  const { elements } = await createApp();
  const [chess, art] = elements["activities-list"].children;

  assert.equal(participantSection(chess).children[0].textContent, "Participants (2)");
  assert.deepEqual(
    participantItems(chess).map((item) => [item.tagName, item.children[0].textContent]),
    [
      ["LI", "michael@mergington.edu"],
      ["LI", "daniel@mergington.edu"],
    ]
  );
  assert.equal(participantSection(art).children[0].textContent, "Participants (0)");
  assert.equal(participantSection(art).children[1].textContent, "No participants yet.");
  assert.equal(participantItems(art).length, 0);
});

test("renders participant-provided markup as text", async () => {
  const activities = activityData();
  const participant = '<img src=x onerror="alert(1)">@example.test';
  activities["Chess Club"].participants = [participant];
  const { elements } = await createApp(activities);
  const [name] = participantItems(elements["activities-list"].children[0])[0].children;

  assert.equal(name.textContent, participant);
  assert.equal(name.innerHTML, "");
  assert.equal(name.children.length, 0);
});

test("refreshes participants and availability after each successful signup", async () => {
  const app = await createApp();
  await app.submit("alex+chess@mergington.edu", "Chess Club");

  let [chess, art] = app.elements["activities-list"].children;
  assert.deepEqual(
    participantNames(chess),
    ["michael@mergington.edu", "daniel@mergington.edu", "alex+chess@mergington.edu"]
  );
  assert.match(chess.innerHTML, /2 spots left/);
  assert.equal(app.elements.message.className, "success");
  assert.equal(app.elements.email.value, "");
  assert.equal(app.elements.activity.value, "");

  await app.submit("sam@mergington.edu", "Art Club");
  [chess, art] = app.elements["activities-list"].children;
  assert.deepEqual(participantNames(art), ["sam@mergington.edu"]);
  assert.match(art.innerHTML, /4 spots left/);
  assert.deepEqual(
    app.elements.activity.options.map((option) => option.value),
    ["", "Chess Club", "Art Club"]
  );
  assert.ok(app.state.requests.some(({ url }) => url.includes("alex%2Bchess%40mergington.edu")));
});

test("preserves a new form selection while a refresh is pending", async () => {
  const app = await createApp();
  app.state.delayActivities = true;
  const signup = app.submit("alex@mergington.edu", "Chess Club");
  await flush();

  assert.equal(app.state.pendingActivities.length, 1);
  app.elements.email.value = "draft@mergington.edu";
  app.elements.activity.value = "Art Club";
  app.state.pendingActivities[0]();
  await signup;

  assert.equal(app.elements.email.value, "draft@mergington.edu");
  assert.equal(app.elements.activity.value, "Art Club");
});

test("does not let an older refresh overwrite a newer signup", async () => {
  const app = await createApp();
  app.state.delayActivities = true;
  const firstSignup = app.submit("first@mergington.edu", "Chess Club");
  await flush();
  const secondSignup = app.submit("second@mergington.edu", "Chess Club");
  await flush();

  assert.equal(app.state.pendingActivities.length, 2);
  app.state.pendingActivities[1]();
  await secondSignup;
  app.state.pendingActivities[0]();
  await firstSignup;

  const [chess] = app.elements["activities-list"].children;
  assert.deepEqual(
    participantNames(chess),
    [
      "michael@mergington.edu",
      "daniel@mergington.edu",
      "first@mergington.edu",
      "second@mergington.edu",
    ]
  );
});

test("keeps the form and cards intact when a signup fails", async () => {
  const app = await createApp();
  await app.submit("michael@mergington.edu", "Chess Club");

  assert.equal(app.elements.message.className, "error");
  assert.equal(app.elements.message.textContent, "Student already signed up for this activity");
  assert.equal(app.elements.email.value, "michael@mergington.edu");
  assert.equal(app.elements.activity.value, "Chess Club");
  assert.equal(participantItems(app.elements["activities-list"].children[0]).length, 2);
  assert.equal(app.state.requests.filter(({ url }) => url === "/activities").length, 1);
});

test("reports activity load failures, including a failed post-signup refresh", async () => {
  const failedInitialLoad = await createApp(activityData(), 503);
  assert.match(failedInitialLoad.elements["activities-list"].innerHTML, /Failed to load activities/);
  assert.equal(failedInitialLoad.state.errors.length, 1);

  const app = await createApp();
  app.state.nextActivitiesStatus = 503;
  await app.submit("alex@mergington.edu", "Chess Club");

  assert.equal(app.elements.message.className, "success");
  assert.match(app.elements["activities-list"].innerHTML, /Failed to load activities/);
  assert.equal(app.state.errors.length, 1);
});

test("unregisters a participant and refreshes the activity card", async () => {
  const app = await createApp();
  const [chess] = app.elements["activities-list"].children;
  const [participant] = participantItems(chess);
  const removeButton = participant.children[1];

  assert.equal(removeButton.className, "participant-remove");
  assert.equal(removeButton["aria-label"], "Unregister michael@mergington.edu");
  await removeButton.listeners.click();

  const [updatedChess] = app.elements["activities-list"].children;
  assert.deepEqual(participantNames(updatedChess), ["daniel@mergington.edu"]);
  assert.equal(participantSection(updatedChess).children[0].textContent, "Participants (1)");
  assert.match(updatedChess.innerHTML, /4 spots left/);
  assert.ok(app.state.requests.some(({ url, method }) =>
    method === "DELETE" &&
    url === "/activities/Chess%20Club/signup?email=michael%40mergington.edu"
  ));
});
