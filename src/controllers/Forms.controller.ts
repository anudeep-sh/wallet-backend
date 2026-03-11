import { v4 as uuidv4 } from "uuid";
import knex from "../database/db";

export class FormsController {
  // Create new form
  createForm = async (ctx: any) => {
    try {
      const formData = {
        id: uuidv4(),
        ...ctx.request.body,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      };

      // Validate required type field
      if (!formData.type) {
        ctx.status = 400;
        ctx.body = { message: "Form type is required" };
        return;
      }

      const result = await knex("forms").insert(formData).returning("*");

      ctx.body = {
        message: "Form created successfully",
        data: result[0],
      };
      ctx.status = 201;
    } catch (error) {
      console.error("Error creating form:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  // Get all forms with pagination and filtering
  getForms = async (ctx: any) => {
    try {
      const page = parseInt(ctx.query.page) || 1;
      const limit = parseInt(ctx.query.limit) || 10;
      const type = ctx.query.type;
      const offset = (page - 1) * limit;

      let query = knex("forms").select("*").orderBy("created_at", "desc");

      // Add type filter if provided
      if (type) {
        query = query.where({ type });
      }

      const forms = await query.limit(limit).offset(offset);

      const totalQuery = knex("forms");
      if (type) {
        totalQuery.where({ type });
      }
      const total = await totalQuery.count("id as count").first();

      ctx.body = {
        data: forms,
        pagination: {
          page,
          limit,
          total: total?.count || 0,
          totalPages: Math.ceil(Number(total?.count || 0) / limit),
        },
      };
      ctx.status = 200;
    } catch (error) {
      console.error("Error fetching forms:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  getFormsByShortCode = async (ctx: any) => {
    try {
      const { shortcode, page = 1, limit = 100 } = ctx.query;
      const offset = (page - 1) * limit;
  
      let query = knex("forms")
        .select("*")
        .whereRaw("userinfo_meta->>'shortcode' = ?", [shortcode]) // Query inside JSON field
        .orderBy("created_at", "desc");
  
      const forms = await query.limit(limit).offset(offset);
  
      const totalQuery = knex("forms")
        .whereRaw("userinfo_meta->>'shortcode' = ?", [shortcode]);
      const total = await totalQuery.count("id as count").first();
  
      ctx.body = {
        data: forms,
        pagination: {
          page,
          limit,
          total: total?.count || 0,
          totalPages: Math.ceil(Number(total?.count || 0) / limit),
        },
      };
      ctx.status = 200;
    } catch (error) {
      console.error("Error fetching forms:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  // Get form by ID
  getFormById = async (ctx: any) => {
    try {
      const { id } = ctx.params;

      const form = await knex("forms").where({ id }).first();

      if (!form) {
        ctx.status = 404;
        ctx.body = { message: "Form not found" };
        return;
      }

      ctx.body = { data: form };
      ctx.status = 200;
    } catch (error) {
      console.error("Error fetching form:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  // Update form
  updateForm = async (ctx: any) => {
    try {
      const { id } = ctx.params;
      const updateData = {
        ...ctx.request.body,
        updated_at: knex.fn.now(),
      };

      const result = await knex("forms")
        .where({ id })
        .update(updateData)
        .returning("*");

      if (result.length === 0) {
        ctx.status = 404;
        ctx.body = { message: "Form not found" };
        return;
      }

      ctx.body = {
        message: "Form updated successfully",
        data: result[0],
      };
      ctx.status = 200;
    } catch (error) {
      console.error("Error updating form:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  // Delete form
  deleteForm = async (ctx: any) => {
    try {
      const { id } = ctx.params;

      const result = await knex("forms").where({ id }).del();

      if (result === 0) {
        ctx.status = 404;
        ctx.body = { message: "Form not found" };
        return;
      }

      ctx.body = { message: "Form deleted successfully" };
      ctx.status = 200;
    } catch (error) {
      console.error("Error deleting form:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  // Form Options Management
  createFormOptions = async (ctx: any) => {
    try {
      const optionData = {
        id: uuidv4(),
        ...ctx.request.body,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      };

      // Validate required fields
      if (
        !optionData.form_type ||
        !optionData.form_field ||
        !optionData.options
      ) {
        ctx.status = 400;
        ctx.body = {
          message: "form_type, form_field, and options are required",
        };
        return;
      }

      const result = await knex("options_for_forms")
        .insert(optionData)
        .returning("*");

      ctx.body = {
        message: "Form options created successfully",
        data: result[0],
      };
      ctx.status = 201;
    } catch (error: any) {
      if (error?.code === "23505") {
        // Unique constraint violation
        ctx.status = 409;
        ctx.body = {
          message: "Form options already exist for this form type and field",
        };
        return;
      }
      console.error("Error creating form options:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  // Get form options by type
  getFormOptions = async (ctx: any) => {
    try {
      const { form_type } = ctx.params;

      const options = await knex("options_for_forms")
        .where({ form_type })
        .select("*");

      ctx.body = { data: options };
      ctx.status = 200;
    } catch (error) {
      console.error("Error fetching form options:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  // Update form options
  updateFormOptions = async (ctx: any) => {
    try {
      const { id } = ctx.params;
      const updateData = {
        ...ctx.request.body,
        updated_at: knex.fn.now(),
      };

      const result = await knex("options_for_forms")
        .where({ id })
        .update(updateData)
        .returning("*");

      if (result.length === 0) {
        ctx.status = 404;
        ctx.body = { message: "Form options not found" };
        return;
      }

      ctx.body = {
        message: "Form options updated successfully",
        data: result[0],
      };
      ctx.status = 200;
    } catch (error: any) {
      if (error?.code === "23505") {
        // Unique constraint violation
        ctx.status = 409;
        ctx.body = {
          message: "Form options already exist for this form type and field",
        };
        return;
      }
      console.error("Error updating form options:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };

  // Delete form options
  deleteFormOptions = async (ctx: any) => {
    try {
      const { id } = ctx.params;

      const result = await knex("options_for_forms").where({ id }).del();

      if (result === 0) {
        ctx.status = 404;
        ctx.body = { message: "Form options not found" };
        return;
      }

      ctx.body = { message: "Form options deleted successfully" };
      ctx.status = 200;
    } catch (error) {
      console.error("Error deleting form options:", error);
      ctx.status = 500;
      ctx.body = { message: "Internal server error" };
    }
  };
}
