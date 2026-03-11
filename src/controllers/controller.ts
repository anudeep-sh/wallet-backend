import { INetwork } from "../types/types";
import { v4 as uuidv4 } from "uuid";
const bcrypt = require("bcrypt");
import knex from "../database/db";
import * as jwt from "jsonwebtoken";
import { Status, Type, WITHDRAWAL_STATUS } from "../models/types";
import { generateUniqueId } from "../utilities/helper";

export class NetworkController implements INetwork {
  registerController = async (ctx: any) => {
    try {
      const { username, email, password } = ctx.request.body;
      const id = uuidv4();
      const tenDigitCode = generateUniqueId();
      const hash = await bcrypt.hash(password, 10);

      const newUser = await knex("users")
        .insert({
          id,
          name: username.toLowerCase(),
          emailId: email.toLowerCase(),
          password: hash,
          status: Status.ACTIVE,
          shortcode: tenDigitCode,
        })
        .returning("*");

      const wallet = await knex("wallet_history")
        .insert({ id: uuidv4(), user_id: id, amount: 0.0, type: Type.CREDIT })
        .returning("*");
      const userQuota = await knex("user_quota")
        .insert({ id: uuidv4(), user_id: id })
        .returning("*");

      // Generate JWT token
      newUser[0].password = "";
      const token = jwt.sign({ userPayload: newUser[0] }, "SAI_RAM", {
        expiresIn: "24h", // Set the token expiration time
      });
      if (
        email === "anudeep4n@gmail.com" ||
        email === "sairamlakanavarapu@gmail.com"
      ) {
        ctx.body = {
          user: newUser,
          token,
          wallet: wallet[0],
          userQuota,
          role: "ADMIN",
        };
      } else {
        ctx.body = {
          user: newUser,
          token,
          wallet: wallet[0],
          userQuota,
          role: "USER",
        };
      }
    } catch (err: any) {
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  userDetailsById = async (ctx: any) => {
    try {
      const userDetails = ctx.state.userPayload;
      const user = await knex("users")
        .select("*")
        .where({ id: userDetails.id })
        .returning("*");
      user[0].password = "";
      ctx.body = { data: user[0] };
      ctx.status = 201;
    } catch (error) {
      console.log(error);
      ctx.body = "Something went Wrong";
      ctx.status = 500;
    }
  };

  updatePasswordController = async (ctx: any) => {
    try {
      const { userId } = ctx.params; // Get userId from URL parameters
      const { newPassword } = ctx.request.body; // Get new password from the request body

      // Validate inputs
      if (!userId || !newPassword) {
        ctx.status = 400;
        ctx.body = { message: "userId and newPassword are required." };
        return;
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update the password in the database
      const updatedRows = await knex("users")
        .where({ id: userId })
        .update({ password: hashedPassword })
        .returning("*");

      if (updatedRows.length === 0) {
        ctx.status = 404;
        ctx.body = { message: "User not found." };
        return;
      }

      // Remove password from the response for security
      updatedRows[0].password = "";

      // Respond with the updated user info
      ctx.status = 200;
      ctx.body = {
        message: "Password updated successfully.",
        user: updatedRows[0],
      };
    } catch (err: any) {
      ctx.status = 500;
      ctx.body = { message: "Internal Server Error", error: err.message };
    }
  };

  getAllUsersWalletAndLevelController = async (ctx: any) => {
    try {
      // Fetch all users
      const users = await knex("users").select(
        "id",
        "name",
        "emailId",
        "shortcode",
        "status",
        "pan_number",
        "aadhar_number",
        "bank_account_number",
        "ifsc_code",
        "upi_linkedin_number"
      );

      if (users.length === 0) {
        ctx.status = 404;
        ctx.body = { message: "No users found" };
        return;
      }

      // Fetch wallet history and level for each user
      const userDetailsWithWalletAndLevel = await Promise.all(
        users.map(async (user) => {
          // Fetch wallet history for each user
          const walletHistory = await knex("wallet_history")
            .select("id", "amount", "type", "timestamp")
            .where({ user_id: user.id });

          // Fetch the level from the network and hub tables
          const userNetwork = await knex("network")
            .select("hub.level", "hub.name")
            .join("hub", "network.hub_id", "=", "hub.id")
            .where({ "network.user_id": user.id })
            .first();

          return {
            user,
            walletHistory,
            level: userNetwork ? userNetwork.level : null,
            hubName: userNetwork ? userNetwork.name : null,
          };
        })
      );

      // Construct the response
      ctx.body = {
        users: userDetailsWithWalletAndLevel,
      };
      ctx.status = 200;
    } catch (error) {
      console.error("Error fetching users wallet and level:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal Server Error" };
    }
  };

  loginController = async (ctx: any) => {
    try {
      const { email, password } = ctx.request.body;

      const user = await knex("users")
        .where({ emailId: email.toLowerCase() })
        .returning("*");
      if (user.length == 0) {
        ctx.body = "Invalid email or password";
        ctx.status = 401;
        return;
      }

      if (!(await bcrypt.compare(password, user[0].password))) {
        ctx.body = "Invalid email or password";
        ctx.status = 401;
        return;
      }
      user[0].password = "";
      let hubDetails: any;

      try {
        const networkEntry = await knex("network")
          .where({ user_id: user[0].id })
          .first();

        if (networkEntry && networkEntry.hub_id) {
          hubDetails = await knex("hub")
            .where({ id: networkEntry.hub_id })
            .first();
        }
      } catch (err) {
        console.log(err);
      }

      // Generate JWT token
      const token = jwt.sign({ userPayload: user[0] }, "SAI_RAM", {
        expiresIn: "24h", // Set the token expiration time
      });
      if (
        email === "anudeep4n@gmail.com" ||
        email === "sairamlakanavarapu@gmail.com"
      ) {
        ctx.body = { user, token, hubDetails, role: "ADMIN" };
      } else {
        ctx.body = { user, token, hubDetails, role: "USER" };
      }
    } catch (err: any) {
      console.error(err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  gibilloginController = async (ctx: any) => {
    try {
      const { Username, Password } = ctx.request.body;
      const username = Username;
      const password = Password;

      const user = await knex("users")
        .where({ emailId: username.toLowerCase() })
        .returning("*");
      if (user.length == 0) {
        ctx.body = "Invalid email or password";
        ctx.status = 401;
        return;
      }

      if (!(await bcrypt.compare(password, user[0].password))) {
        ctx.body = "Invalid email or password";
        ctx.status = 401;
        return;
      }
      user[0].password = "";
      let hubDetails: any;

      try {
        const networkEntry = await knex("network")
          .where({ user_id: user[0].id })
          .first();

        if (networkEntry && networkEntry.hub_id) {
          hubDetails = await knex("hub")
            .where({ id: networkEntry.hub_id })
            .first();
        }
      } catch (err) {
        console.log(err);
      }

      // Generate JWT token
      const token = jwt.sign({ userPayload: user[0] }, "SAI_RAM", {
        expiresIn: "24h", // Set the token expiration time
      });
      if (
        username === "anudeep4n@gmail.com" ||
        username === "sairamlakanavarapu@gmail.com"
      ) {
        ctx.body = {
          user,
          UserToken: token,
          hubDetails,
          role: "ADMIN",
          HasError: false,
        };
      } else {
        ctx.body = {
          user,
          UserToken: token,
          hubDetails,
          role: "USER",
          HasError: false,
        };
      }
    } catch (err: any) {
      console.error(err);
      ctx.body = {
        UserToken: null,
        DisplayName: null,
        HasError: true,
        Errors: [
          {
            ErrorCode: 3999,
            ErrorMessage: "Please Provide Correct Password.",
            HasError: true,
          },
        ],
      };
      ctx.status = 500;
    }
  };

  getQuotaByUserIdController = async (ctx: any) => {
    try {
      const { userId } = ctx.params;

      // Query to get quota and user details for the specific user_id
      const quota = await knex("user_quota")
        .select(
          "user_quota.level1_quota",
          "user_quota.level2_quota",
          "user_quota.level3_quota",
          "user_quota.level4_quota",
          "user_quota.level5_quota",
          "users.id",
          "users.shortcode",
          "users.name",
          "users.emailId",
          "users.status",
          "users.timestamp"
        )
        .leftJoin("users", "user_quota.user_id", "users.id")
        .where("user_quota.user_id", userId)
        .first(); // Using .first() to get a single record
      const userNetwork = await knex("network")
        .select("hub.level", "hub.name")
        .join("hub", "network.hub_id", "=", "hub.id")
        .where({ "network.user_id": userId })
        .first();

      if (!quota) {
        ctx.body = {
          error: "User not found or no quota available for this user",
        };
        ctx.status = 404;
        return;
      }

      ctx.body = { quota, userInfo: userNetwork };
      ctx.status = 200;
    } catch (err: any) {
      console.error(err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  getWalletDetails = async (ctx: any) => {
    try {
      const userDetails = ctx.state.userPayload;

      // Fetch the wallet details for the authenticated user
      const wallet = await knex("wallet_history")
        .where({ user_id: userDetails.id })
        .returning("*");

      if (!wallet) {
        ctx.body = "Wallet not found";
        ctx.status = 404;
        return;
      }
      const walletValue = wallet[0];
      const finalPrice = wallet.reduce((accumulator: number, curvalue: any) => {
        if (curvalue.type === "CREDIT") {
          console.log(parseInt(curvalue.amount) + accumulator, "INSIDE");
          return parseInt(curvalue.amount) + accumulator;
        } else {
          return accumulator - parseInt(curvalue.amount);
        }
      }, 0);
      walletValue.amount = finalPrice;
      ctx.body = { wallet: walletValue };
    } catch (err: any) {
      console.error(err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  getWalletHistoryDetails = async (ctx: any) => {
    try {
      const userDetails = ctx.state.userPayload;

      // Fetch the wallet details for the authenticated user
      const wallet = await knex("wallet_history")
        .where({ user_id: userDetails.id })
        .returning("*");

      if (!wallet) {
        ctx.body = "Wallet not found";
        ctx.status = 404;
        return;
      }
      ctx.body = { data: wallet };
    } catch (err: any) {
      console.error(err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  joinController = async (ctx: any) => {
    try {
      const referralPayload = ctx.state.userPayload;
      const { shortcode, level } = ctx.request.body;

      if (referralPayload.role === "ADMIN") {
        const id = uuidv4();
        const userDetails = await knex("users")
          .where({ shortcode: shortcode })
          .returning("*");
        if (userDetails.length == 0) {
          (ctx.body = "NO_USER_EXIST_WITH_THAT_STATUS_CODE"),
            (ctx.status = 400);
          return;
        }
        const hubDetails = await knex("hub")
          .where({ level: level })
          .returning("*");
        if (hubDetails.length == 0) {
          (ctx.body = "NOT_CORRECT_LEVEL"), (ctx.status = 400);
          return;
        }
        const membershipDetails = await knex("network")
          .insert({
            id,
            user_id: userDetails[0].id,
            referrer_id: referralPayload.id,
            hub_id: hubDetails[0].id,
            type: Type.CREDIT,
          })
          .returning("*");
        const walletUniqueId = uuidv4();
        const wallet = await knex("wallet_history")
          .insert({
            id: walletUniqueId,
            user_id: referralPayload.id,
            amount: parseInt(hubDetails[0].price),
            type: Type.CREDIT,
          })
          .returning("*");
        ctx.body = { membershipDetails: "Successfully referred" };
        ctx.status = 201;
      } else {
        // Fetch the referrer's current quota
        let userQuota = await knex("user_quota")
          .where({ user_id: referralPayload.id })
          .first();
        if (!userQuota) {
          // Initialize quotas for all levels if not present
          userQuota = await knex("user_quota")
            .insert({
              id: uuidv4(),
              user_id: referralPayload.id,
              level1_quota: 0,
              level2_quota: 0,
              level3_quota: 0,
              level4_quota: 0,
              level5_quota: 0,
            })
            .returning("*");
        }

        // Check the specific level quota
        const quotaField = `level${level}_quota`;
        if (userQuota[quotaField] <= 0) {
          ctx.body =
            "You do not have enough quota to refer a new member at this level";
          ctx.status = 400;
          return;
        }
        const fetchUserNetworkDetails = await knex("network")
          .where({ user_id: referralPayload.id })
          .returning("*");
        if (fetchUserNetworkDetails.length == 0) {
          (ctx.body = "YOU_DO_NOT_HAVE_ANY_SUBSCRIPTION"), (ctx.status = 400);
          return;
        }
        const referralDetails = await knex("network")
          .select(
            "network.id",
            "network.type",
            "network.timestamp",
            "hub.name as hub_name",
            "hub.level",
            "hub.price"
          )
          .leftJoin("hub", "network.hub_id", "hub.id")
          .where("network.user_id", referralPayload.id);
        if (referralDetails.length === 0) {
          (ctx.body = "SOMETHING_WENT_WRONG_PLEASE_RE_LOGIN_BY_REMOVING_CACHE"),
            (ctx.status = 400);
          return;
        }
        if (level < referralDetails[0].level) {
          (ctx.body = "PLEASE_UPDATE_YOUR_SUBSCRIPTION"), (ctx.status = 400);
          return;
        }
        const id = uuidv4();
        const userDetails = await knex("users")
          .where({ shortcode: shortcode })
          .returning("*");
        if (userDetails.length == 0) {
          (ctx.body = "NO_USER_EXIST_WITH_THAT_STATUS_CODE"),
            (ctx.status = 400);
          return;
        }
        const hubDetails = await knex("hub")
          .where({ level: level })
          .returning("*");
        if (hubDetails.length == 0) {
          (ctx.body = "NOT_CORRECT_LEVEL"), (ctx.status = 400);
          return;
        }
        const existingUser = await knex("network")
          .select("user_id")
          .where({ user_id: userDetails[0].id })
          .first();

        if (existingUser) {
          // If user_id exists, throw an error
          ctx.status = 400;
          ctx.body = "User already exists in the network.";
          return;
        }
        const membershipDetails = await knex("network").insert({
          id,
          user_id: userDetails[0].id,
          referrer_id: referralPayload.id,
          hub_id: hubDetails[0].id,
          type: Type.CREDIT,
        });

        // Reduce the referrer's quota for the specific level
        await knex("user_quota")
          .where({ user_id: referralPayload.id })
          .decrement(quotaField, 1);

        await this.updateWalletDetails(userDetails, hubDetails[0]?.price);

        ctx.body = { membershipDetails: membershipDetails[0] };
        ctx.status = 201;
      }
    } catch (err: any) {
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  addHUBController = async (ctx: any) => {
    try {
      const id = uuidv4();
      const { level, name, price } = ctx.request.body;
      const newLevel = await knex("hub")
        .insert({
          id,
          name,
          level,
          price,
        })
        .returning("*");

      ctx.body = { level: newLevel[0] };
    } catch (err: any) {
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  networkController = async (ctx: any) => {
    try {
      // Fetch users and network data
      const users = await knex("users").select(
        "id",
        "name",
        "emailId",
        "shortcode"
      );
      const network = await knex("network").select("user_id", "referrer_id");

      // Map users by their ID for quick access
      const userMap = new Map();
      users.forEach((user) => {
        userMap.set(user.id, { ...user, children: [] });
      });

      // Build the hierarchical network structure
      network.forEach((connection) => {
        const user = userMap.get(connection.user_id);
        const referrer = userMap.get(connection.referrer_id);
        // Ensure we don't add a user as their own child
        if (referrer && referrer.id !== user.id) {
          referrer.children.push({
            ...user,
            attributes: {
              name: user.name,
              shortcode: user.shortcode,
            },
          });
        }
      });

      // Identify root nodes
      const rootNodes: any = [];
      userMap.forEach((user) => {
        if (
          network.some(
            (connection) =>
              connection.user_id === user.id &&
              connection.referrer_id === user.id
          )
        ) {
          rootNodes.push(user);
        }
      });

      ctx.body = { data: rootNodes };
    } catch (err: any) {
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  updateQuotaController = async (ctx: any) => {
    try {
      const { userId, amount, level } = ctx.request.body;

      // Validate level is between 1-4
      if (!level || level < 1 || level > 5) {
        ctx.body = "Invalid level. Must be between 1 and 5";
        ctx.status = 400;
        return;
      }

      // Check if user exists
      const userExists = await knex("users").where({ id: userId }).first();
      if (!userExists) {
        ctx.body = "User not found";
        ctx.status = 404;
        return;
      }

      const quotaColumn = `level${level}_quota`; // Dynamically create column name

      // Check if user quota exists
      const userQuota = await knex("user_quota")
        .where({ user_id: userId })
        .first();

      if (!userQuota) {
        // If quota doesn't exist, create a new entry with the provided amount
        const newQuota = {
          id: uuidv4(),
          user_id: userId,
          level1_quota: 0,
          level2_quota: 0,
          level3_quota: 0,
          level4_quota: 0,
          level5_quota: 0,
          [quotaColumn]: amount, // Set the specific level quota
        };
        await knex("user_quota").insert(newQuota);
      } else {
        // If quota exists, update the specific level quota
        await knex("user_quota")
          .where({ user_id: userId })
          .update({
            [quotaColumn]: knex.raw("?? + ?", [quotaColumn, amount]),
            updated_at: knex.fn.now(),
          });
      }

      ctx.body = { message: `Level ${level} quota updated successfully` };
      ctx.status = 200;
    } catch (err: any) {
      console.error(err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  postQuotaController = async (ctx: any) => {
    try {
      const { userId, level, quota } = ctx.request.body;

      // Check if user exists
      const userExists = await knex("users").where({ id: userId }).first();
      if (!userExists) {
        ctx.body = "User not found";
        ctx.status = 404;
        return;
      }

      // Check if user quota exists
      let userQuota = await knex("user_quota")
        .where({ user_id: userId })
        .first();

      if (!userQuota) {
        // If no quota exists, insert a new entry with default quotas
        userQuota = await knex("user_quota")
          .insert({
            id: uuidv4(),
            user_id: userId,
            level1_quota: 0,
            level2_quota: 0,
            level3_quota: 0,
            level4_quota: 0,
            level5_quota: 0,
          })
          .returning("*");
      }

      // Determine which level's quota to update
      const updateData: any = {};

      if (level === 1) {
        updateData.level1_quota = quota;
      } else if (level === 2) {
        updateData.level2_quota = quota;
      } else if (level === 3) {
        updateData.level3_quota = quota;
      } else if (level === 4) {
        updateData.level4_quota = quota;
      } else if (level === 5) {
        updateData.level5_quota = quota;
      }

      // Update the specified level's quota
      await knex("user_quota").where({ user_id: userId }).update(updateData);

      ctx.body = { message: "Quota set successfully" };
      ctx.status = 200;
    } catch (err: any) {
      console.error(err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  getQuotasController = async (ctx: any) => {
    try {
      // Query to get quotas with user details
      // Query to get quotas with user details
      const quotas = await knex("user_quota")
        .select(
          "user_quota.level1_quota",
          "user_quota.level2_quota",
          "user_quota.level3_quota",
          "user_quota.level4_quota",
          "user_quota.level5_quota",
          "users.id as user_id",
          "users.shortcode",
          "users.name",
          "users.emailId",
          "users.status",
          "users.timestamp",
          "referrer.id as referrer_id",
          "referrer.name as referrer_name",
          "referrer.emailId as referrer_email",
          "referrer.shortcode as referrer_shortcode"
        )
        .leftJoin("users", "user_quota.user_id", "users.id")
        .leftJoin("network", "users.id", "network.user_id")
        .leftJoin("users as referrer", "network.referrer_id", "referrer.id");

      ctx.body = { quotas };
      ctx.status = 200;
    } catch (err: any) {
      console.error(err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  getLevelsController = async (ctx: any) => {
    try {
      const levels = await knex("hub").select("*");
      ctx.body = { levels };
    } catch (err: any) {
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  withdrawalController = async (ctx: any) => {
    try {
      const walletValue: any = await this.walletMoney(ctx);
      const { withdrawal_amount } = ctx.request.body;

      console.log(
        walletValue,
        "walletValue",
        withdrawal_amount,
        typeof withdrawal_amount
      );
      if (walletValue < withdrawal_amount) {
        (ctx.body = "your asking more than in wallet we can not process this"),
          (ctx.status = 400);
        return;
      }
      const id = uuidv4();
      const userPayload = ctx.state.userPayload;
      const withdrawalResponse = await knex("withdrawals")
        .insert({
          id,
          user_id: userPayload.id,
          amount: withdrawal_amount,
          status: WITHDRAWAL_STATUS.PENDING,
        })
        .returning("*");
      ctx.status = 201;
      ctx.body = { data: withdrawalResponse[0] };
    } catch (err) {
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  getWithdrawals = async (ctx: any) => {
    try {
      // Fetch all withdrawal records for a specific user
      const withdrawals = await knex("withdrawals")
        .select("id", "amount", "status", "timestamp")
        .where({ user_id: ctx.state.userPayload.id })
        .orderBy("timestamp", "desc");

      // Send the response
      ctx.body = withdrawals;
      ctx.status = 200;
    } catch (err) {
      console.error("Error fetching withdrawals:", err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  updateWithDrawalRequest = async (ctx: any) => {
    try {
      const { status, withdrawalId } = ctx.request.body;
      const withdrawalResponse = await knex("withdrawals")
        .where({ id: withdrawalId })
        .returning("*");
      ctx.state.userPayload.id = withdrawalResponse[0]?.user_id;
      const walletValue: any = await this.walletMoney(ctx);
      console.log(walletValue, withdrawalResponse[0]?.amount);
      if (walletValue < withdrawalResponse[0]?.amount) {
        (ctx.body = "your asking more than in wallet we can not process this"),
          (ctx.status = 400);
        return;
      }
      const updateWithdrawalResponse = await knex("withdrawals")
        .update({ status: status })
        .where({ id: withdrawalId })
        .returning("*");
      if (status === WITHDRAWAL_STATUS.APPROVED) {
        await knex("wallet_history").insert({
          id: uuidv4(),
          user_id: ctx.state.userPayload.id,
          amount: withdrawalResponse[0].amount,
          type: Type.WITHDRAWAL,
        });
      }
      ctx.status = 200;
      ctx.body = {
        data: updateWithdrawalResponse,
      };
    } catch (err) {
      ctx.status = 500;
      ctx.body = "Internal Server Error";
    }
  };

  withdrawalList = async (ctx: any) => {
    try {
      const status = ctx.params.status;
      const withDrawalResponse = await knex("withdrawals")
        .select(
          "withdrawals.*",
          "users.name as user_name",
          "users.emailId as user_email",
          "users.shortcode as user_shortcode",
          "users.pan_number",
          "users.aadhar_number",
          "users.bank_account_number",
          "users.ifsc_code",
          "users.upi_linkedin_number"
        )
        .join("users", "withdrawals.user_id", "=", "users.id")
        .where({ "withdrawals.status": status });
      ctx.body = { data: withDrawalResponse };
      ctx.status = 200;
    } catch (err) {
      ctx.status = 500;
      ctx.body = "Internal Server Error";
    }
  };

  walletMoney = async (ctx: any) => {
    const userDetails = ctx.state.userPayload;

    // Fetch the wallet details for the authenticated user
    const wallet = await knex("wallet_history")
      .where({ user_id: userDetails.id })
      .returning("*");

    console.log(wallet, "wallet");

    if (!wallet) {
      ctx.body = "Wallet not found";
      ctx.status = 404;
      return;
    }
    const finalPrice = wallet.reduce((accumulator: number, curvalue: any) => {
      if (curvalue.type === "CREDIT") {
        return accumulator + parseInt(curvalue.amount);
      } else {
        return accumulator - parseInt(curvalue.amount);
      }
    }, 0);

    console.log(finalPrice, "finalPrice");
    return finalPrice;
  };
  updateWalletDetails = async (userDetails: any, price: number) => {
    const distribution = [
      { level: 1, percentage: 50 },
      { level: 2, percentage: 30 },
      { level: 3, percentage: 10 },
      { level: 4, percentage: 10 },
      { level: 5, percentage: 0 },
    ];
    let finallyCompanywallet = price;
    let userDetailId = userDetails[0].id;
    for (let i = 0; i < 5; i++) {
      const walletUserId = await knex("network")
        .select("*")
        .where({ user_id: userDetailId });
      if (walletUserId.length === 0) {
        break;
      }
      const amountToTransfer = (price * distribution[i].percentage) / 100;
      finallyCompanywallet = finallyCompanywallet - amountToTransfer;
      userDetailId = walletUserId[0]?.referrer_id;
      const wallet = await knex("wallet_history").insert({
        id: uuidv4(),
        user_id: walletUserId[0]?.referrer_id,
        amount: amountToTransfer,
        type: Type.CREDIT,
      });
    }
    const adminDetails = await knex("users")
      .where({ emailId: "sairamlakanavarapu@gmail.com" })
      .returning("*");
    await knex("wallet_history").insert({
      id: uuidv4(),
      user_id: adminDetails[0]?.id,
      amount: finallyCompanywallet,
      type: Type.CREDIT,
    });
  };

  patchUserDetailsController = async (ctx: any) => {
    try {
      const {
        userId,
        pan_number,
        aadhar_number,
        bank_account_number,
        ifsc_code,
        upi_linkedin_number,
      } = ctx.request.body;

      // Check if user exists
      const userExists = await knex("users").where({ id: userId }).first();
      if (!userExists) {
        ctx.body = "User not found";
        ctx.status = 404;
        return;
      }

      // Create an object to hold the fields that need updating
      const updateData: any = {};

      if (pan_number) updateData.pan_number = pan_number;
      if (aadhar_number) updateData.aadhar_number = aadhar_number;
      if (bank_account_number)
        updateData.bank_account_number = bank_account_number;
      if (ifsc_code) updateData.ifsc_code = ifsc_code;
      if (upi_linkedin_number)
        updateData.upi_linkedin_number = upi_linkedin_number;

      // If there are fields to update
      if (Object.keys(updateData).length > 0) {
        await knex("users").where({ id: userId }).update(updateData);
        ctx.body = { message: "User details updated successfully" };
        ctx.status = 200;
      } else {
        ctx.body = { message: "No valid fields provided for update" };
        ctx.status = 400;
      }
    } catch (err: any) {
      console.error(err);
      ctx.body = "Internal Server Error";
      ctx.status = 500;
    }
  };

  updateWalletDetailsAsPerUserId = async (ctx: any) => {
    try {
      const { user_id, amount } = ctx.request.body;
      if (!amount || typeof amount !== "number") {
        (ctx.body = "invalid amount"), (ctx.status = 400);
        return;
      }
      // Check if user exists
      const userExists = await knex("users").where({ id: user_id }).first();
      if (!userExists) {
        ctx.body = "User not found";
        ctx.status = 404;
        return;
      }
      const wallet = await knex("wallet_history")
        .insert({ id: uuidv4(), user_id, amount, type: Type.CREDIT })
        .returning("*");
      (ctx.body = "wallet updated"), (ctx.status = 200);
    } catch (err) {
      ctx.body = "Wallet Update Failed";
      ctx.status = 500;
    }
  };

  storeRetailerDataAPI = async (ctx: any) => {
    try {
      const { urc, umc, ak, fname, lname, email, phno, pin, adh, pan } =
        ctx.request.body;

      // Validate input parameters
      if (!urc || !umc || !ak || !fname || !lname || !email || !phno || !pin) {
        ctx.status = 400;
        ctx.body = { message: "Missing required parameters." };
        return;
      }
      // Check if user exists
      const userExists = await knex("users").where({ shortcode: urc }).first();
      if (!userExists) {
        ctx.body = "User not found";
        ctx.status = 404;
        return;
      }
      const id = uuidv4();
      // Insert retailer data into `gibilusers`
      await knex("gibilusers").insert({
        id: uuidv4(),
        refno: id,
        urc,
        umc,
        ak,
        fname,
        lname,
        email,
        phno,
        pin,
        adh,
        pan,
      });

      ctx.status = 200;
      ctx.body = { message: "Retailer data stored successfully." };
    } catch (err) {
      console.error(err);
      ctx.status = 500;
      ctx.body = { message: "Internal Server Error" };
    }
  };

  premiumDeductionAPI = async (ctx: any) => {
    try {
      const { refno, ak, urc, umc, ptype, pamt, reqtime } = ctx.request.body;
      // Validate input parameters
      if (!refno || !ak || !urc || !umc || !ptype || !pamt || !reqtime) {
        ctx.status = 400;
        ctx.body = { message: "Missing required parameters." };
        return;
      }
      // // Verify `ak` matches the unique authorization key from environment
      // if (ak !== 'kdjfowfjoew424i2ej4') {
      //   ctx.status = 403;
      //   ctx.body = { message: "Invalid authorization key." };
      //   return;
      // }
      const userDetails = await knex("users")
        .where({ shortcode: urc })
        .returning("*");
      if (userDetails.length == 0) {
        (ctx.body = "NO_USER_EXIST_WITH_THAT_STATUS_CODE"), (ctx.status = 400);
        return;
      }
      // Fetch wallet balance for the retailer
      const wallet = await knex("wallet_history")
        .where({ user_id: userDetails[0].id })
        .select("amount", "type");

      const walletBalance = wallet.reduce(
        (accumulator: number, record: any) => {
          if (record.type === "CREDIT")
            return accumulator + parseFloat(record.amount);
          return accumulator - parseFloat(record.amount);
        },
        0
      );
      if (walletBalance < pamt) {
        ctx.status = 400;
        ctx.body = {
          refno,
          status: 1003,
          message: "FAIL",
          resptime: new Date().toISOString(),
        };
        return;
      }

      // Deduct premium amount
      await knex("wallet_history").insert({
        id: uuidv4(),
        user_id: userDetails[0].id,
        amount: pamt,
        type: "WITHDRAWAL",
        // timestamp: reqtime,
      });
      // Update gibilusers with transaction details
      await knex("gibilusers").where({ ak }).update({
        refno,
        pampt: pamt,
        pstatus: "DEBITED",
        ptype,
        // reqtime,
      });
      ctx.status = 200;
      ctx.body = {
        refno,
        status: 1001,
        message: "SUCCESS",
        resptime: new Date().toISOString(),
      };
    } catch (err) {
      console.error(err);
      ctx.status = 500;
      ctx.body = {
        refno: ctx.request.body.refno,
        status: 1003,
        message: "FAIL",
        resptime: new Date().toISOString(),
      };
    }
  };
  policyConfirmationAPI = async (ctx: any) => {
    try {
      const {
        refno,
        ak,
        urc,
        umc,
        pamt,
        pstatus,
        ptype,
        payout,
        retailer_payout,
        distributor_payout,
        reqtime,
      } = ctx.request.body;
      console.log(ctx.request.body);
      // Validate input parameters
      if (
        !refno ||
        !ak ||
        !urc ||
        !umc ||
        !pamt ||
        !ptype ||
        !payout ||
        !reqtime
      ) {
        ctx.status = 400;
        ctx.body = { message: "Missing required parameters." };
        return;
      }
      const userDetails = await knex("users")
        .where({ shortcode: urc })
        .returning("*");
      if (userDetails.length == 0) {
        (ctx.body = "NO_USER_EXIST_WITH_THAT_STATUS_CODE"), (ctx.status = 400);
        return;
      }

      // Verify `ak` matches the unique authorization key from environment
      // if (ak !== 'kdjfowfjoew424i2ej4') {
      //   ctx.status = 403;
      //   ctx.body = { message: "Invalid authorization key." };
      //   return;
      // }

      // Handle confirmation or reversal based on `pstatus`
      if (pstatus === 1 || pstatus === "1") {
        // Update gibilusers for confirmed policy
        await knex("gibilusers").where({ ak }).update({
          pampt: pamt,
          pstatus: "CONFIRMED",
          ptype,
          payout,
          retailer_payout,
          distributor_payout,
        });

        ctx.status = 200;
        ctx.body = {
          status: 1001,
          refno,
          message: "SUCCESS",
          resptime: new Date().toISOString(),
        };
      } else {
        // Update gibilusers for reversal
        await knex("wallet_history").insert({
          id: uuidv4(),
          user_id: userDetails[0].id,
          amount: pamt,
          type: "CREDIT",
          // timestamp: reqtime,
        });
        await knex("gibilusers").where({ ak }).update({
          pampt: pamt,
          pstatus: "REVERSED",
          ptype,
        });

        ctx.status = 200;
        ctx.body = {
          status: 1001,
          refno,
          message: "REVERSAL_SUCCESS",
          resptime: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error(err);
      ctx.status = 500;
      ctx.body = {
        status: 1003,
        refno: ctx.request.body.refno,
        message: "FAIL",
        resptime: new Date().toISOString(),
      };
    }
  };
}
