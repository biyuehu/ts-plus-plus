import {
  loadUser,
  UserId,
} from "../dist/index.js";

const result = loadUser();
if (result._tag === "Found") {
  const id: UserId = result.value.id;
  console.log(id, result.value.name);
}
