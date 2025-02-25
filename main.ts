import dayjs from "dayjs";
import fetch from "node-fetch";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteerType from "puppeteer-extra/dist/puppeteer";
import semver from "semver";

import { LicenseClass } from "./api/interfaces";
import { logger } from "./logger";
import {
  listenForResponses,
  ELIGIBILITY_CHECK_ID,
  BOOKING_DATES_ID,
  BOOKING_TIMES_ID,
  LOCATIONS_ID,
} from "./responseListener";
import {
  login,
  selectLicenseType,
  findAvailabilities,
  waitToEnterBookingPage,
} from "./scraper";
import { Coordinates, Result } from "./utils";

export interface CliOptions {
  email: string;
  licenseNumber: string;
  licenseExpiry: string;
  licenseType: LicenseClass;
  radius: number;
  location: Coordinates;
  months: number;
  chromiumPath: string;
}

async function checkCliUpdate() {
  const res = await fetch(
    "https://github.com/silverAndroid/drivetest-ca-availabilities/releases/latest"
  );
  const { version: currentVersion } = require("./package.json");
  const newVersion = res.url.split("/").slice(-1)[0];

  if (semver.lt(currentVersion, newVersion)) {
    return res.url;
  }

  return null;
}

export async function main(options: CliOptions) {
  logger.info("Checking for updates...");
  const updateUrl = await checkCliUpdate();
  if (updateUrl) {
    logger.info(
      "Found new update at %s! Please update to the latest version.",
      updateUrl
    );
    return;
  } else {
    logger.info(
      "No new updates found, current version %s",
      require("./package.json").version
    );
  }

  const {
    email,
    licenseNumber,
    licenseExpiry,
    licenseType,
    radius,
    location,
    months,
    chromiumPath,
  } = options;

  let browser: puppeteerType.Browser | undefined;
  try {
    puppeteer.use(StealthPlugin());
    browser = await puppeteer.launch({
      headless: false,
      executablePath: chromiumPath,
      defaultViewport: null as unknown as undefined,
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(0);
    page.setDefaultNavigationTimeout(0);

    listenForResponses(page, (req) => {
      const url = req.url();
      if (url === "https://drivetest.ca/booking/v1/eligibilityCheck") {
        return ELIGIBILITY_CHECK_ID;
      } else if (url.startsWith("https://drivetest.ca/booking/v1/booking/")) {
        return BOOKING_DATES_ID;
      } else if (url.startsWith("https://drivetest.ca/booking/v1/booking")) {
        return BOOKING_TIMES_ID;
      } else if (url === "https://drivetest.ca/booking/v1/location") {
        return LOCATIONS_ID;
      }

      return null;
    });

    await page.goto("https://drivetest.ca/book-a-road-test/booking.html");

    await waitToEnterBookingPage(page);
    logger.info("Logging in...");
    await login(page, email, licenseNumber, licenseExpiry);
    logger.info("Finding available times for a %s exam", licenseType);
    await selectLicenseType(page, licenseType);

    const foundResults: {
      type: Result.FOUND;
      name: string;
      time: Date;
    }[] = [];

    while (true) {
      for await (const result of findAvailabilities(
        page,
        radius,
        location,
        licenseType,
        months
      )) {
        if (result.type === Result.SEARCHING) {
          logger.info(
            "Searching %s at location %s",
            dayjs().month(result.month).format("MMMM"),
            result.name
          );
        } else if (result.type === Result.FAILED) {
          logger.error(
            "Couldn't search %s due to error %d:%s",
            result.name,
            result.error.code,
            result.error.message
          );
        } else {
          logger.info(
            "Found new time for location %s, %s",
            result.name,
            dayjs(result.time).format("MMMM DD, YYYY [at] hh:mm a")
          );
          foundResults.push(result);
        }
      }

      if (foundResults.length === 0) {
        logger.error("No timeslots found");
      } else {
        logger.info("Found %d available time slots:");
        for (const result of foundResults) {
          logger.info(
            "• %s, %s",
            result.name,
            dayjs(result.time).format("MMMM DD, YYYY [at] hh:mm a")
          );
        }
      }
      logger.info("Sleep 60000");
      await sleep(60000);
      logger.info("Try again");
    }
  } finally {
    browser?.close();
    logger.info('If you appreciate my work, feel free to buy me a ☕️ (coffee) here 😊: https://www.buymeacoffee.com/rushilperera')
  }

  function sleep (time : number) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }
  
}
