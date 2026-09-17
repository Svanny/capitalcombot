const HIGH_RISK_METHODS = new Set([
  "auth.connectSaved",
  "positions.close",
  "positions.reverse",
  "positions.updateProtection",
  "orders.openMarket",
  "schedules.cancel",
  "schedules.pause",
  "schedules.reactivate",
  "schedules.update",
  "targetPosition.update",
]);

export const HELP = `Capital.com Trading Assistant CLI

Usage:
  pnpm cli -- <command> [arguments] [options]

Commands:
  status
  auth connect [--identifier ID] [--password PASSWORD] [--api-key KEY] [--environment demo|live]
  auth connect-saved | disconnect | forget-saved
  markets search [QUERY]
  markets select <EPIC>
  quote
  positions list
  positions close <DEAL_ID>
  positions reverse <DEAL_ID>
  positions protect <DEAL_ID> --epic EPIC --direction BUY|SELL --protection JSON
  orders open <EPIC> --direction BUY|SELL --size NUMBER [--schedule JSON] [--protection JSON]
  orders preview <EPIC> --direction BUY|SELL --protection JSON
  schedules list
  schedules cancel|pause|reactivate <JOB_ID>
  schedules update <JOB_ID> --direction BUY|SELL --size NUMBER --schedule JSON
                   [--protection JSON] [--target-position JSON]
  target-position enable <JOB_ID> --direction BUY|SELL --size NUMBER
  target-position disable <JOB_ID>
  call <METHOD> [--input JSON]

Global options:
  -y, --yes       Confirm actions that place trades or mutate broker/app state
  --compact       Print compact JSON
  -h, --help      Show this help

Credential environment variables:
  CAPITALCOM_IDENTIFIER, CAPITALCOM_PASSWORD, CAPITALCOM_API_KEY,
  CAPITALCOM_ENVIRONMENT

Examples:
  pnpm cli -- status
  pnpm cli -- auth connect-saved --yes
  pnpm cli -- markets search Gold
  pnpm cli -- orders open GOLD --direction BUY --size 0.1 --yes
  pnpm cli -- positions close DEAL_ID --yes
`;

export function parseCommand(argv, environment = process.env) {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const { positionals, options } = parseArguments(normalizedArgv);
  const command = positionals[0];

  if (!command || command === "help" || options.help) {
    return { help: true, compact: Boolean(options.compact) };
  }

  let method;
  let input;

  if (command === "status" && positionals.length === 1) {
    method = "app.bootstrap";
  } else if (command === "quote" && positionals.length === 1) {
    method = "quotes.getSelected";
  } else if (command === "auth") {
    ({ method, input } = parseAuth(positionals, options, environment));
  } else if (command === "markets") {
    ({ method, input } = parseMarkets(positionals, options));
  } else if (command === "positions") {
    ({ method, input } = parsePositions(positionals, options));
  } else if (command === "orders") {
    ({ method, input } = parseOrders(positionals, options));
  } else if (command === "schedules") {
    ({ method, input } = parseSchedules(positionals, options));
  } else if (command === "target-position") {
    ({ method, input } = parseTargetPosition(positionals, options));
  } else if (command === "call") {
    method = requiredPositional(positionals, 1, "Provide a method after 'call'.");
    input = options.input === undefined ? undefined : parseJson(options.input, "--input");
  } else {
    throw new Error(`Unknown command: ${positionals.join(" ")}`);
  }

  return {
    help: false,
    method,
    input,
    compact: Boolean(options.compact),
    assumeYes: Boolean(options.yes),
    requiresConfirmation: HIGH_RISK_METHODS.has(method),
  };
}

function parseTargetPosition(positionals, options) {
  const action = positionals[1];
  const jobId = requiredPositional(positionals, 2, "Provide either target pair's scheduled-order job ID.");

  if (action === "enable") {
    return {
      method: "targetPosition.update",
      input: {
        jobId,
        targetPosition: {
          enabled: true,
          direction: parseDirection(requiredOption(options, "direction")),
          size: parsePositiveNumber(requiredOption(options, "size"), "--size"),
        },
      },
    };
  }
  if (action === "disable") {
    return {
      method: "targetPosition.update",
      input: { jobId, targetPosition: { enabled: false } },
    };
  }
  throw new Error("Use: target-position enable|disable <JOB_ID>");
}

function parseAuth(positionals, options, environment) {
  switch (positionals[1]) {
    case "connect": {
      const selectedEnvironment = options.environment ?? environment.CAPITALCOM_ENVIRONMENT ?? "demo";
      if (selectedEnvironment !== "demo" && selectedEnvironment !== "live") {
        throw new Error("--environment must be demo or live.");
      }
      return {
        method: "auth.connect",
        input: {
          identifier: requiredValue(options.identifier ?? environment.CAPITALCOM_IDENTIFIER, "--identifier or CAPITALCOM_IDENTIFIER"),
          password: requiredValue(options.password ?? environment.CAPITALCOM_PASSWORD, "--password or CAPITALCOM_PASSWORD"),
          apiKey: requiredValue(options["api-key"] ?? environment.CAPITALCOM_API_KEY, "--api-key or CAPITALCOM_API_KEY"),
          environment: selectedEnvironment,
        },
      };
    }
    case "connect-saved":
      return { method: "auth.connectSaved" };
    case "disconnect":
      return { method: "auth.disconnect" };
    case "forget-saved":
      return { method: "auth.forgetSaved" };
    default:
      throw new Error("Use: auth connect|connect-saved|disconnect|forget-saved");
  }
}

function parseMarkets(positionals) {
  switch (positionals[1]) {
    case "search":
      return { method: "markets.searchGold", input: positionals.slice(2).join(" ") || "Gold" };
    case "select":
      return { method: "markets.select", input: requiredPositional(positionals, 2, "Provide a market EPIC.") };
    default:
      throw new Error("Use: markets search [QUERY] or markets select <EPIC>");
  }
}

function parsePositions(positionals, options) {
  const action = positionals[1];
  if (action === "list") return { method: "positions.listOpen" };
  const dealId = requiredPositional(positionals, 2, "Provide a position deal ID.");
  if (action === "close") return { method: "positions.close", input: { dealId } };
  if (action === "reverse") return { method: "positions.reverse", input: { dealId } };
  if (action === "protect") {
    return {
      method: "positions.updateProtection",
      input: {
        dealId,
        epic: requiredOption(options, "epic"),
        direction: parseDirection(requiredOption(options, "direction")),
        protection: parseJson(requiredOption(options, "protection"), "--protection"),
      },
    };
  }
  throw new Error("Use: positions list|close|reverse|protect");
}

function parseOrders(positionals, options) {
  const action = positionals[1];
  const epic = requiredPositional(positionals, 2, "Provide a market EPIC.");
  const base = {
    epic,
    direction: parseDirection(requiredOption(options, "direction")),
  };

  if (action === "open") {
    return {
      method: "orders.openMarket",
      input: {
        ...base,
        size: parsePositiveNumber(requiredOption(options, "size"), "--size"),
        ...(options.schedule === undefined ? {} : { schedule: parseJson(options.schedule, "--schedule") }),
        ...(options.protection === undefined ? {} : { protection: parseJson(options.protection, "--protection") }),
      },
    };
  }
  if (action === "preview") {
    return {
      method: "orders.previewProtection",
      input: {
        ...base,
        protection: parseJson(requiredOption(options, "protection"), "--protection"),
      },
    };
  }
  throw new Error("Use: orders open|preview");
}

function parseSchedules(positionals, options) {
  const action = positionals[1];
  if (action === "list") return { method: "schedules.list" };
  const jobId = requiredPositional(positionals, 2, "Provide a scheduled-order job ID.");
  if (["cancel", "pause", "reactivate"].includes(action)) {
    return { method: `schedules.${action}`, input: { jobId } };
  }
  if (action === "update") {
    return {
      method: "schedules.update",
      input: {
        jobId,
        direction: parseDirection(requiredOption(options, "direction")),
        size: parsePositiveNumber(requiredOption(options, "size"), "--size"),
        schedule: parseJson(requiredOption(options, "schedule"), "--schedule"),
        ...(options.protection === undefined ? {} : { protection: parseJson(options.protection, "--protection") }),
        ...(options["target-position"] === undefined
          ? {}
          : { targetPosition: parseJson(options["target-position"], "--target-position") }),
      },
    };
  }
  throw new Error("Use: schedules list|cancel|pause|reactivate|update");
}

function parseArguments(argv) {
  const positionals = [];
  const options = {};
  let parsingOptions = true;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      parsingOptions = false;
    } else if (parsingOptions && (argument === "-h" || argument === "--help")) {
      options.help = true;
    } else if (parsingOptions && (argument === "-y" || argument === "--yes")) {
      options.yes = true;
    } else if (parsingOptions && argument === "--compact") {
      options.compact = true;
    } else if (parsingOptions && argument.startsWith("--")) {
      const equalsIndex = argument.indexOf("=");
      const name = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
      if (!name) throw new Error("Invalid empty option.");
      if (equalsIndex !== -1) {
        options[name] = argument.slice(equalsIndex + 1);
      } else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) throw new Error(`Option --${name} requires a value.`);
        options[name] = value;
        index += 1;
      }
    } else {
      positionals.push(argument);
    }
  }
  return { positionals, options };
}

function requiredPositional(positionals, index, message) {
  return requiredValue(positionals[index], message);
}

function requiredOption(options, name) {
  return requiredValue(options[name], `Provide --${name}.`);
}

function requiredValue(value, description) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${description}`);
  return value.trim();
}

function parseDirection(value) {
  const direction = value.toUpperCase();
  if (direction !== "BUY" && direction !== "SELL") throw new Error("--direction must be BUY or SELL.");
  return direction;
}

function parsePositiveNumber(value, option) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${option} must be greater than 0.`);
  return number;
}

function parseJson(value, option) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${option} must contain valid JSON.`);
  }
}
