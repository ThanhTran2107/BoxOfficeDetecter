const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs"); // Reintroduce standard fs for existsSync
const fsPromises = require("fs").promises; // Use fs.promises for async operations
const _ = require("lodash");
const axios = require("axios");

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const config = {
  botToken: "8115761966:AAFDf7Bj504fr33IMT5sjIsXokmTpLM1uh0",
  chatId: "7469756965",
  imageUrl:
    "https://i.pinimg.com/736x/64/06/28/640628296e5d6ba71daa2d906bb4d6d4.jpg",
  dataFile: "data.json",
  newDataFile: "newData.json",
  screenshotFile: "youtube_search.png",
  targetUrl: "https://boxofficevietnam.com/",
};

// Function to build a formatted message for the top 3 movies
const buildMovieMessage = (movies) => {
  console.log("Building message for movies:", movies);
  return `🎬 Xin chào! Cập nhật top 3 phim mới hôm nay:\n${movies
    .map(
      (movie, index) =>
        `\n${index + 1}. ${movie.name}\n- Doanh thu: ${movie.revenue}\n- Vé: ${
          movie.ticket
        }\n- Suất chiếu: ${movie.screening}\n`
    )
    .join("")}`;
};

// Function to send a message with an image via Telegram
const sendMessage = async (message, imageUrl) => {
  const url = `https://api.telegram.org/bot${config.botToken}/sendPhoto`;
  console.log("Sending message to Telegram with image:", imageUrl);

  try {
    const response = await axios.post(url, {
      chat_id: config.chatId,
      photo: imageUrl,
      caption: message,
    });
    console.log("Successfully sent photo + caption");
    return response.data;
  } catch (error) {
    console.error(
      "Error sending photo + caption:",
      error.response?.data || error.message
    );
    throw error;
  }
};

// Function to read JSON file with error handling
const readJsonFile = async (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(await fsPromises.readFile(filePath, "utf8"));
    }
    return [];
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
};

// Function to write JSON file with error handling
const writeJsonFile = async (filePath, data) => {
  try {
    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error(`Error writing to ${filePath}:`, error.message);
    throw error;
  }
};

// Main function to scrape movie data and detect changes
const runDetecter = async () => {
  console.log("Starting Puppeteer browser...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  console.log("New browser page created.");

  try {
    console.log(`Navigating to ${config.targetUrl}...`);
    await page.goto(config.targetUrl, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Check and close landing page if present
    if (await page.$(".close-button")) {
      console.log("Clicking close button...");
      await page.click(".close-button");
      await page
        .waitForNavigation({ waitUntil: "networkidle0", timeout: 10000 })
        .catch(() => {});
    }

    // Scrape movie data
    console.log("Scraping movie data from page...");
    const movieList = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("#table_1 tbody tr"))
        .map((tr) => {
          const [name, revenue, ticket, screening] = tr.querySelectorAll("td");
          return name && revenue && ticket && screening
            ? {
                name: name.innerText.trim(),
                revenue: revenue.innerText.trim(),
                ticket: ticket.innerText.trim(),
                screening: screening.innerText.trim(),
              }
            : null;
        })
        .filter(Boolean);
    });

    // Read existing data
    const currentData = await readJsonFile(config.dataFile);

    // Find new movies
    const newMovies = _.differenceWith(
      movieList,
      currentData,
      (a, b) => a.name.trim() === b.name.trim()
    );
    if (newMovies.length > 0) {
      console.log(
        "New movies detected:",
        newMovies.map((mv) => mv.name).join(", ")
      );
    }

    // Save data to files
    await Promise.all([
      writeJsonFile(config.dataFile, movieList),
      writeJsonFile(config.newDataFile, { message: "", movies: newMovies }),
    ]);

    // Compare top 3 movies
    const top3Movies = movieList.slice(0, 3);
    const oldTop3Movies = currentData.slice(0, 3);
    console.log(
      "Current top 3 movies:",
      top3Movies.map((mv) => mv.name).join(", ")
    );

    const isTop3Changed = !_.isEqual(
      top3Movies.map((movie) => movie.name),
      oldTop3Movies.map((movie) => movie.name)
    );

    // Send Telegram message if top 3 changed
    if (isTop3Changed) {
      console.log("Top 3 changed, sending Telegram message...");
      const message = buildMovieMessage(top3Movies);
      await sendMessage(message, config.imageUrl);
    }

    return { success: true, updated: isTop3Changed };
  } catch (error) {
    console.error("⚠️ An error occurred in runDetecter:", error.message);
    return { success: false, error: error.message };
  } finally {
    console.log("Closing browser...");
    await browser.close();
  }
};

// Express route to trigger the detector
app.get("/run", async (req, res) => {
  console.log("Received request to /run endpoint");
  const result = await runDetecter();
  console.log("Run result:", result);
  res.json(result);
});

// Express root route
app.get("/", (req, res) => {
  console.log("Received request to / endpoint");
  res.send("Box Office Detecter đang hoạt động.");
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
