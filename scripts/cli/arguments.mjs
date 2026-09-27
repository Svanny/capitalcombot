const BOOLEAN_OPTIONS = new Set(["help", "yes", "compact"]);
const VALUE_OPTIONS = new Set([
  "identifier", "password", "api-key", "environment", "epic", "direction", "size",
  "schedule", "protection", "target-position", "input",
]);

const COMMAND_SHAPES = {
  "app.bootstrap": [1, []],
  "quotes.getSelected": [1, []],
  "auth.connect": [2, ["identifier", "password", "api-key", "environment"]],
  "auth.connectSaved": [2, []],
  "auth.disconnect": [2, []],
  "auth.forgetSaved": [2, []],
  "markets.searchGold": [Infinity, []],
  "markets.select": [3, []],
  "positions.listOpen": [2, []],
  "positions.close": [3, []],
  "positions.reverse": [3, []],
  "positions.updateProtection": [3, ["epic", "direction", "protection"]],
  "orders.openMarket": [3, ["direction", "size", "schedule", "protection"]],
  "orders.previewProtection": [3, ["direction", "protection"]],
  "schedules.list": [2, []],
  "schedules.cancel": [3, []],
  "schedules.pause": [3, []],
  "schedules.reactivate": [3, []],
  "schedules.update": [3, ["direction", "size", "schedule", "protection", "target-position"]],
};

export function validateCommandArguments(method, positionals, options) {
  const [maxPositionals, allowedOptions] = positionals[0] === "call"
    ? [2, ["input"]]
    : method === "targetPosition.update"
      ? [3, positionals[1] === "enable" ? ["direction", "size"] : []]
      : COMMAND_SHAPES[method];
  if (positionals.length > maxPositionals) throw new Error("Unexpected extra command arguments.");
  for (const name of Object.keys(options)) {
    if (!BOOLEAN_OPTIONS.has(name) && !allowedOptions.includes(name)) {
      throw new Error(`Option --${name} is not valid for this command.`);
    }
  }
}

export function parseArguments(argv) {
  const positionals = [];
  const options = Object.create(null);
  let parsingOptions = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (parsingOptions && argument === "--") {
      parsingOptions = false;
      continue;
    }
    if (!parsingOptions || !argument.startsWith("-")) {
      positionals.push(argument);
      continue;
    }
    const normalized = argument === "-y" ? "--yes" : argument === "-h" ? "--help" : argument;
    const equalsIndex = normalized.indexOf("=");
    const name = normalized.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    if (!normalized.startsWith("--") || (!BOOLEAN_OPTIONS.has(name) && !VALUE_OPTIONS.has(name))) {
      throw new Error(`Unknown option: ${argument.split("=")[0]}`);
    }
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: --${name}`);
    if (BOOLEAN_OPTIONS.has(name)) {
      if (equalsIndex !== -1) throw new Error(`Option --${name} does not accept a value.`);
      options[name] = true;
    } else if (equalsIndex !== -1) {
      options[name] = normalized.slice(equalsIndex + 1);
    } else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--") || value === "-y" || value === "-h") {
        throw new Error(`Option --${name} requires a value.`);
      }
      options[name] = value;
      index += 1;
    }
  }
  return { positionals, options };
}
