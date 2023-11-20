process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});
const schedule = require("node-schedule");
const nodemailer = require("nodemailer");
const { Auction } = require("../../models/auction");
const { Product } = require("../../models/product");
const { User } = require("../../models/user");
const content = require("../../emailContent");
require("dotenv").config();

async function updateAuction(auction) {
  try {
    return await Auction.findOne({ _id: auction._id });
  } catch (error) {
    console.error("Error in updateAuction:", error.message);
    throw error;
  }
}

async function findSubscribersOfThisProduct(auction) {
  try {
    auction = await updateAuction(auction);
    const subscribersOfThatProduct = auction.subscribers;
    const userDBOfSubscribers = await User.find({
      _id: subscribersOfThatProduct,
    });

    var subscribers = "";
    for (var i = 0; i < userDBOfSubscribers.length; i++) {
      subscribers += userDBOfSubscribers[i].email + ", ";
    }
    return subscribers;
  } catch (error) {
    console.error("Error in findSubscribersOfThisProduct:", error.message);
    throw error;
  }
}

async function findSoldToBuyer(auction) {
  try {
    auction = await updateAuction(auction);
    var buyer = "null";
    if (auction.bids.length) {
      const buyerID = auction.bids[0].bidder;
      buyer = await User.findOne({ _id: buyerID });
    }
    return buyer;
  } catch (error) {
    console.error("Error in findSoldToBuyer:", error.message);
    throw error;
  }
}

async function sellerOfThisProduct(auction) {
  try {
    const product = await Product.findOne({ _id: auction.product });
    const sellerID = product.seller;
    const seller = await User.findOne({ _id: sellerID });
    return seller;
  } catch (error) {
    console.error("Error in sellerOfThisProduct:", error.message);
    throw error;
  }
}

const emailNotification = (receiver, subject, text) => {
  var transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SERVICE_PROVIDER_USER,
      pass: process.env.SERVICE_PROVIDER_PASSKEY,
    },
  });

  var mailOptions = {
    from: "auctionwebsitedesisproject@gmail.com",
    to: receiver,
    subject: subject,
    html: text,
  };

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.error("Error in emailNotification:", error.message);
    }
  });
};

async function startAuction(auction) {
  try {
    await Auction.findOneAndUpdate(
      { _id: auction._id },
      {
        auctionStarted: true,
        auctionLive: true,
      }
    );
  } catch (error) {
    console.error("Error in startAuction:", error.message);
    throw error;
  }
}

async function endAuction(auction) {
  try {
    const currAuction = await Auction.findOneAndUpdate(
      { _id: auction._id },
      {
        auctionEnded: true,
        auctionLive: false,
      }
    );

    if (currAuction.bids.length) {
      const maxBidder = currAuction.bids[0].bidder;
      await Auction.findOneAndUpdate(
        { _id: auction._id },
        {
          soldTo: maxBidder,
        }
      );

      await User.findOneAndUpdate(
        { _id: maxBidder },
        {
          $push: { purchasedProducts: auction.product },
        }
      );
    }
  } catch (error) {
    console.error("Error in endAuction:", error.message);
    throw error;
  }
}

async function scheduleReminder(auction) {
  try {
    const reminderDateTime = new Date(
      new Date(auction.startDateTime).getTime() - 60 * 60 * 24 * 1000
    );

    const reminderAuctionJob = schedule.scheduleJob(
      reminderDateTime,
      async function () {
        var subscribers = await findSubscribersOfThisProduct(auction);
        var reminderToSubscribersMail = content.reminderToSubscribersMail(
          auction.productName,
          auction.product
        );

        if (subscribers != "") {
          emailNotification(
            subscribers,
            content.subjectReminder(auction.productName),
            reminderToSubscribersMail
          );
        }
      }
    );
  } catch (error) {
    console.error("Error in scheduleReminder:", error.message);
    throw error;
  }
}

async function scheduleStart(auction) {
  try {
    if (auction.startDateTime < new Date()) {
      startAuction(auction);
      var subscribers = await findSubscribersOfThisProduct(auction);
      var seller = await sellerOfThisProduct(auction);

      var timeDifference =
        new Date().getTime() - new Date(auction.startDateTime).getTime();
      var msec = timeDifference;
      var days = Math.floor(msec / 1000 / 60 / (60 * 24));
      msec -= days * 1000 * 60 * 60 * 24;
      var hh = Math.floor(msec / 1000 / 60 / 60);
      msec -= hh * 1000 * 60 * 60;
      var mm = Math.floor(msec / 1000 / 60);
      msec -= mm * 1000 * 60;
      var ss = Math.floor(msec / 1000);
      msec -= ss * 1000;

      var emailSubscribersAuctionStartLate = content.emailSubscribersAuctionStartLate(
        auction.productName,
        auction.product,
        days,
        hh,
        mm,
        ss
      );

      if (subscribers != "") {
        emailNotification(
          subscribers,
          content.subjectStartLate(auction.productName),
          emailSubscribersAuctionStartLate
        );
      }

      var emailSellerAuctionStartLate = content.emailSellerAuctionStartLate(
        seller.name,
        auction.productName,
        days,
        hh,
        mm,
        ss,
        auction.product
      );

      emailNotification(
        seller.email,
        content.subjectStartLate(auction.productName),
        emailSellerAuctionStartLate
      );
    } else {
      const startAuctionJob = schedule.scheduleJob(
        auction.startDateTime,
        async function () {
          startAuction(auction);
          var subscribers = await findSubscribersOfThisProduct(auction);
          var seller = await sellerOfThisProduct(auction);

          var emailSubscribersAuctionStart = content.emailSubscribersAuctionStart(
            auction.productName,
            auction.product
          );

          var emailSellerAuctionStart = content.emailSellerAuctionStart(
            auction.productName,
            seller.name,
            auction.product
          );

          if (subscribers != "") {
            emailNotification(
              subscribers,
              content.subjectStartNow(auction.productName),
              emailSubscribersAuctionStart
            );
          }

          emailNotification(
            seller.email,
            content.subjectStartNow(auction.productName),
            emailSellerAuctionStart
          );
        }
      );
    }
  } catch (error) {
    console.error("Error in scheduleStart:", error.message);
    throw error;
  }
}

async function scheduleEnd(auction) {
  try {
    if (auction.endDateTime < new Date()) {
      endAuction(auction);
      var buyer = await findSoldToBuyer(auction);
      var seller = await sellerOfThisProduct(auction);
      var updatedAuction = await updateAuction(auction);

      if (buyer != "null") {
        var productCurrentPrice = updatedAuction.bids[0].price;
      }

      var timeDifference =
        new Date().getTime() - auction.startDateTime.getTime();
      var msec = timeDifference;
      var days = Math.floor(msec / 1000 / 60 / (60 * 24));
      msec -= days * 1000 * 60 * 60 * 24;
      var hh = Math.floor(msec / 1000 / 60 / 60);
      msec -= hh * 1000 * 60 * 60;
      var mm = Math.floor(msec / 1000 / 60);
      msec -= mm * 1000 * 60;
      var ss = Math.floor(msec / 1000);
      msec -= ss * 1000;

      var selleremailwithoutbuyer = content.selleremailwithoutbuyer(
        auction.productName,
        seller.name,
        days,
        hh,
        mm,
        auction.product
      );

      if (buyer == "null") {
        emailNotification(
          seller.email,
          content.endLateNotSold(auction.productName),
          selleremailwithoutbuyer
        );
      } else {
        var emailBuyerAuctionEndLate = content.emailBuyerAuctionEndLate(
          auction.productName,
          buyer.name,
          days,
          hh,
          mm,
          seller.name,
          productCurrentPrice,
          auction.product
        );

        var emailSellerAuctionEndLate = content.emailSellerAuctionEndLate(
          auction.productName,
          seller.name,
          days,
          hh,
          mm,
          buyer.name,
          productCurrentPrice,
          auction.product
        );

        emailNotification(
          buyer.email,
          content.endLate(auction.productName),
          emailBuyerAuctionEndLate
        );

        emailNotification(
          seller.email,
          content.endLate(auction.productName),
          emailSellerAuctionEndLate
        );
      }
    } else {
      const endAuctionJob = schedule.scheduleJob(
        auction.endDateTime,
        async function () {
          endAuction(auction);
          var buyer = await findSoldToBuyer(auction);
          var seller = await sellerOfThisProduct(auction);
          var updatedAuction = await updateAuction(auction);

          if (buyer != "null") {
            var productCurrentPrice = updatedAuction.bids[0].price;
          }

          var emailSellerAuctionEndWithoutBuyer = content.emailSellerAuctionEndWithoutBuyer(
            seller.name,
            auction.productName,
            auction.product
          );

          if (buyer == "null") {
            emailNotification(
              seller.email,
              content.endNotSold(auction.productName),
              emailSellerAuctionEndWithoutBuyer
            );
          } else {
            var emailBuyerAuctionEnd = content.emailBuyerAuctionEnd(
              buyer.name,
              auction.productName,
              seller.name,
              productCurrentPrice,
              auction.product
            );

            emailNotification(
              buyer.email,
              content.end(auction.productName),
              emailBuyerAuctionEnd
            );

            var emailSellerAuctionEnd = content.emailSellerAuctionEnd(
              seller.name,
              auction.productName,
              buyer.name,
              productCurrentPrice,
              auction.product
            );

            emailNotification(
              seller.email,
              content.end(auction.productName),
              emailSellerAuctionEnd
            );
          }
        }
      );
    }
  } catch (error) {
    console.error("Error in scheduleEnd:", error.message);
    throw error;
  }
}

async function auctionReminderScheduler() {
  try {
    const auctions = await Auction.find({
      startDateTime: {
        $lte: new Date(new Date().getTime() + 24 * 60 * 60 * 1000),
      },
      auctionStarted: false,
    });

    for (var i = 0; i < auctions.length; i++) {
      scheduleReminder(auctions[i]);
    }
  } catch (error) {
    console.error("Error in auctionReminderScheduler:", error.message);
    throw error;
  }
}

async function auctionsStartScheduler() {
  try {
    const auctions = await Auction.find({
      startDateTime: {
        $lte: new Date(new Date().getTime() + 60 * 60 * 1000),
      },
      auctionStarted: false,
    });

    for (var i = 0; i < auctions.length; i++) {
      await scheduleStart(auctions[i]);
    }
  } catch (error) {
    console.error("Error in auctionsStartScheduler:", error.message);
    throw error;
  }
}

async function auctionsEndScheduler() {
  try {
    const auctions = await Auction.find({
      endDateTime: {
        $lte: new Date(new Date().getTime() + 60 * 60 * 1000),
      },
      auctionEnded: false,
    });

    for (var i = 0; i < auctions.length; i++) {
      await scheduleEnd(auctions[i]);
    }
  } catch (error) {
    console.error("Error in auctionsEndScheduler:", error.message);
    throw error;
  }
}

async function scheduleAll() {
  try {
    await auctionReminderScheduler();
    await auctionsStartScheduler();
    await auctionsEndScheduler();

    // running auctions start and end schedulers every 50 mins
    let startTimeInterval = setInterval(async () => {
      await auctionReminderScheduler();
      await auctionsStartScheduler();
      await auctionsEndScheduler();
    }, 50 * 60 * 1000); //runs every 50 mins
  } catch (error) {
    console.error("Error in scheduleAll:", error.message);
    throw error;
  }
}

module.exports.scheduleAll = scheduleAll;
module.exports.scheduleReminder = scheduleReminder;
module.exports.scheduleStart = scheduleStart;
module.exports.scheduleEnd = scheduleEnd;
