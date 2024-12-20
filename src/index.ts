import express from "express";
import type { Request, Response } from "express";
import "dotenv/config";
import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js";
import path from "path";
import multer from "multer";
import { unlinkSync } from "fs";

import { countries } from "countries-list";
import Database from "better-sqlite3";
import session from "express-session";
import { nanoid } from "nanoid";

import { getPNG } from "qreator/lib/png";
import { readFile, writeFile } from "fs/promises";

import nodemailer from 'nodemailer'

const __dirname = import.meta.dirname;

const demand = <T>(name: string, value: T | undefined): T => {
    if (value === undefined) {
      throw new Error(`${name} is undefined`);
    } else {
      return value;
    }
  };

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    auth: {
        user: demand('GMAIL_USERNAME', process.env.GMAIL_USERNAME),
        pass: demand('GMAIL_APP_PASSWORD', process.env.GMAIL_APP_PASSWORD) 
    }
})


const COUNTRIES = Object.entries(countries).map(([code, country]) => ({
  code,
  name: country.name,
}));
COUNTRIES.sort(({ name: a }, { name: b }) => a.localeCompare(b));

declare module "express-session" {
  interface SessionData {
    admin: boolean;
  }
}

const app = express();

app.set("view engine", "ejs");
app.use(
  session({
    secret: demand("COOKIE_SECRET", process.env.COOKIE_SECRET),
    cookie: { secure: true },
    resave: false,
    saveUninitialized: true,
  }),
);
app.set("trust proxy", 1); // trust nginx about http
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../static")));
app.use(express.urlencoded({ extended: true }));

const db = new Database(path.join(__dirname, "../hazy.db"), {
  fileMustExist: true,
});

const mimeToFileExtension = (mime: string): string => {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    default:
      throw new Error("Invalid mime type");
  }
};

const ORIGIN = demand("ORIGIN", process.env.ORIGIN);

const storage = multer.diskStorage({
  destination: path.resolve(__dirname, "../uploads"),
  filename: (_, file, cb) => {
    cb(null, `${nanoid()}.${mimeToFileExtension(file.mimetype)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 /* 10mb */ },
  fileFilter: (_, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/msword" ||
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

const render = (
  _: Request,
  res: Response,
  path: string,
  params: Record<string, any>,
) => {
  res.render("base", { path, params });
};

app.get("/", (req, res) => {
  render(req, res, "form", {
    title: "MinneHack",
    COUNTRIES,
    error: false,
    previous: {},
    hadFile: false,
  });
});

const MALE_GENDERS = ["man", "male", "boy", "m"];
const FEMALE_GENDERS = ["woman", "female", "girl", "f"];

const UMN_SPELLINGS = [
  "university of minnesota",
  "umn",
  "u of m",
  "university of minnesota twin cities",
  "university of minnesota, twin cities",
  "university of minnesota-twin cities",
  "university of minnesota twin cities (umn)",
  "university of minnesota, twin cities (umn)",
  "university of minnesota-twin cities (umn)",
];

const registrationSchema = z
  .object({
    email: z.string().max(100).email().trim(),
    name: z.string().max(100).min(1).trim(),
    gender: z
      .string()
      .max(100)
      .min(1)
      .trim()
      .transform((s) => {
        s = s.toLocaleLowerCase();
        // coalesce common ones
        if (MALE_GENDERS.includes(s)) {
          return "male";
        } else if (FEMALE_GENDERS.includes(s)) {
          return "female";
        } else {
          return s;
        }
      }),
    phone: z
      .string()
      .max(100)
      .min(1)
      .trim()
      .refine(
        (number) => isValidPhoneNumber(number, "US"),
        "Invalid phone number",
      ),
    country: z.enum(Object.keys(countries) as [string, ...string[]]),
    school: z
      .string()
      .max(100)
      .min(1)
      .trim()
      .transform((s) => {
        if (UMN_SPELLINGS.includes(s.toLocaleLowerCase())) {
          return "University of Minnesota Twin Cities";
        } else {
          return s;
        }
      }),
    level_of_study: z.enum([
      "middle",
      "high",
      "undergrad",
      "grad",
      "phd",
      "postdoc",
    ]),
    age: z.coerce.number().int().positive().lte(100),
    tshirt: z.enum(["xs", "s", "m", "l", "xl", "xxl"]),
    driving: z.coerce
      .boolean()
      .optional()
      .transform((b) => (b ? 1 : 0)),

    discord_tag: z
      .string()
      .max(100)
      .trim()
      .optional()
      .transform((s) => s || null),

    reimbursement: z.coerce
      .boolean()
      .optional()
      .transform((b) => (b ? 1 : 0)),
    reimbursement_amount: z
      .string()
      .transform((s) => {
        if (s !== "") {
          return parseInt(s.replaceAll(",", ""));
        } else {
          return null;
        }
      })
      .optional()
      .transform((s) => s || null),
    reimbursement_desc: z
      .string()
      .max(10_000)
      .trim()
      .optional()
      .transform((s) => s || null),
    reimbursement_strict: z
      .boolean()
      .optional()
      .transform((b) => (b ? 1 : 0)),

    accomodations: z.string().max(100).trim().default(""),
    dietary_restrictions: z.string().max(100).trim().default(""),
  })
  .refine((data) => {
    if (data.reimbursement) {
      return (
        data.reimbursement_amount !== undefined &&
        data.reimbursement_desc !== undefined &&
        data.reimbursement_strict !== undefined
      );
    } else {
      return true;
    }
  });

type RegistrationError = Record<
  keyof z.infer<typeof registrationSchema>,
  { message: string }
>;

const transformError = (error: z.ZodError): RegistrationError => {
  const errors: RegistrationError = {} as RegistrationError;
  for (const issue of error.issues) {
    errors[issue.path[0] as keyof z.infer<typeof registrationSchema>] = {
      message: issue.message,
    };
  }
  return errors;
};

const EMAIL = demand("EMAIL", process.env.EMAIL);
const DISCORD_LINK = demand("DISCORD_LINK", process.env.DISCORD_LINK);

app.post("/registration", upload.single("resume"), async (req, res) => {
  const { success, data, error } = registrationSchema.safeParse(req.body);
  if (success) {
    try {
      const registration_code = nanoid();
      const resume_filename = req.file?.filename || null;
      db.prepare(
        `
            insert into registrations
            (
                email,
                name,
                gender,
                phone,
                country,
                school,
                level_of_study,
                age,
                tshirt,
                driving,
                discord_tag,
                reimbursement,
                reimbursement_amount,
                reimbursement_desc,
                reimbursement_strict,
                resume_filename,
                accomodations,
                dietary_restrictions,
                registration_code
            )
            values
            (
                @email,
                @name,
                @gender,
                @phone,
                @country,
                @school,
                @level_of_study,
                @age,
                @tshirt,
                @driving,
                @discord_tag,
                @reimbursement,
                @reimbursement_amount,
                @reimbursement_desc,
                @reimbursement_strict,
                @resume_filename,
                @accomodations,
                @dietary_restrictions,
                @registration_code
            )
            `,
      ).run({ ...data, registration_code, resume_filename });


      const message = {
        to: data.email,
        from: EMAIL,
        subject: "Your MinneHack registration",
        text: `
            Hello ${data.name},

            Thank you for registering for MinneHack! We're excited to have you join us.
            In order to stay in contact, you should consider joining our Discord server: ${DISCORD_LINK}

            When you arrive at the event, you should re-open this email in a client that supports HTML,
            so you can show us your QR code. You can also download it from this link: ${ORIGIN}/r/${registration_code}

            If you have any questions, feel free to reply to this email.
        `,
        html: `
            <p>Hello ${data.name},</p>
            <p>Thank you for registering for MinneHack! We're excited to have you join us.</p>
            <p>In order to stay in contact, you should consider joining our <a href="${DISCORD_LINK}">Discord server</a>.</p>
            <p>When you arrive at the event, here's the QR code you should show us in order to sign in:</p>
            <img src="${ORIGIN}/r/${registration_code}.png" alt="QR code" />
            <a href="${ORIGIN}/r/${registration_code}">If the image above doesn't work, click here.</a>
            <p>If you have any questions, feel free to reply to this email.</p>
        `,
      }

      await transporter.sendMail(message)

      res.redirect("thanks");
    } catch (e) {
      render(req, res.status(500), "form", {
        path: "form",
        error: {
          general: {
            message:
              "Sorry, we had an error processing your submission. Please try to re-submit.",
          },
        },
        COUNTRIES,
        previous: req.body,
        hadFile: !!req.file,
      });
    }
  } else {
    const e = transformError(error);
    console.log(e);
    const hadFile = !!req.file;
    if (req.file) {
      unlinkSync(req.file.path);
    }
    render(req, res.status(400), "form", {
      path: "form",
      error: e,
      COUNTRIES,
      previous: req.body,
      hadFile,
    });
  }
});

app.get("/thanks", (req, res) => {
  render(req, res, "thanks", { title: "MinneHack | Thanks" });
});

const ADMIN_USERNAME = demand("ADMIN_USERNAME", process.env.ADMIN_USERNAME);
const ADMIN_PASSWORD = demand("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD);

app.get("/admin", (req, res) => {
  render(req, res, "login", { title: "MinneHack | Admin" });
});

app.post("/admin", (req, res) => {
  const { username, password } = req.body;
  // Dear employers,
  // I know this is insecure. We don't need a real login system here.
  // Thank you.
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    render(req, res, "logged-in", { title: "Logged in :)" });
  } else {
    res.redirect("admin");
  }
});

app.get("/registration/:code", (req, res) => {
  const { code } = req.params;
  if (!code || typeof code !== "string" || !req.session?.admin) {
    render(req, res.status(404), "error", {
      title: "MinneHack | Error",
      message: "Invalid registration code",
    });
  } else {
    const registration = db
      .prepare("select * from registrations where registration_code = ?")
      .get(code);
    if (!registration) {
      render(req, res.status(404), "error", {
        title: "MinneHack | Error",
        message: "Invalid registration code",
      });
    } else {
      render(req, res, "registration", {
        title: "MinneHack | Registration",
        registration,
      });
    }
  }
});

app.post("/registration/:code/check-in", (req, res) => {
  const { code } = req.params;
  if (!code || typeof code !== "string" || !req.session?.admin) {
    render(req, res, "error", {
      title: "MinneHack | Error",
      message: "Invalid registration code",
    });
  } else {
    db.prepare(
      "update registrations set checked_in = 1, checked_in_at = current_timestamp where registration_code = ?",
    ).run(code);
    res.redirect(`/registration/${code}`);
  }
});

app.post("/api/registration/:code/check-in", (req, res) => {
  const { code } = req.params;
  if (!code || typeof code !== "string" || !req.session?.admin) {
    res.status(400).json({ error: "Invalid registration code", success: false });
  } else {
    db.prepare(
      "update registrations set checked_in = 1, checked_in_at = current_timestamp where registration_code = ?",
    ).run(code);
    res.json({ success: true, error: false });
  }
})

app.post("/registration/:code/check-out", (req, res) => {
  const { code } = req.params;
  if (!code || typeof code !== "string" || !req.session?.admin) {
    render(req, res, "error", {
      title: "MinneHack | Error",
      message: "Invalid registration code",
    });
  } else {
    db.prepare(
      "update registrations set checked_in = 0, checked_in_at = null where registration_code = ?",
    ).run(code);
    res.redirect(`/registration/${code}`);
  }
})

app.get("/registrations", (req, res) => {
  if (!req.session?.admin) {
    render(req, res.status(403), "error", {
      title: "MinneHack | Error",
      message: "Not authorized",
    });
  } else {
    const registrations = db.prepare("select * from registrations").all();
    render(req, res, "registrations", {
      title: "MinneHack | Registrations",
      registrations,
    });
  }
})

const QR_CACHE = path.join(__dirname, "../qr-cache");

app.get('/r/:code', async (req, res) => {
    let { code } = req.params;
    if(code.endsWith('.png')) {
    	code = code.slice(0, code.length - 4)
    }
    if (!code || typeof code !== 'string') {
        render(req, res.status(400), "error", {
        title: "MinneHack | Error",
        message: "Invalid registration code",
        });
    } else {
        const registration = db
        .prepare("select * from registrations where registration_code = ?")
        .get(code);

        if (!registration) {
        render(req, res.status(404), "error", {
            title: "MinneHack | Error",
            message: "Invalid registration code",
        });
        }
        // i hate exceptions
        try {
            const existingQR = await readFile(path.join(QR_CACHE, `${code}.png`));
            res.setHeader('Content-Type', 'image/png');
            res.send(existingQR);
            return;
        } catch(_) {
            const pngBuffer = await getPNG(`${ORIGIN}/registration/${code}`, {
                logo: path.join(__dirname, "../static/mh.png")
            });

            await writeFile(path.join(QR_CACHE, `${code}.png`), pngBuffer);

            res.setHeader('Content-Type', 'image/png');
            res.send(pngBuffer);
        }     
    }
})


app.use(
  (err: Error & { status: number }, req: Request, res: Response, _: any) => {
    console.error(err);

    const statusCode = err.status || 500;
    res.status(statusCode);

    render(req, res, "error", {
      title: "MinneHack | Error",
      message: err.message || "Internal Server Error",
    });
  },
);



app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
