'use server';

import { z } from 'zod';
import { sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { User } from './definitions';
import bcrypt from 'bcrypt';

// Define the User schema with Zod
const userSchema = z.object({
  id: z.string(),
  name: z.string().min(5, 'Name must be at least 5 characters long').nonempty('Name cannot be empty'),
  email: z.string().email('Invalid email address').nonempty('Email cannot be empty'),
  password: z.string().min(6, 'Password must be at least 6 characters long').nonempty('Password cannot be empty')
});

async function isEmailUnique(email: string): Promise<number> {
  // Use safe interpolation for the email parameter
  const result = await sql`
    SELECT COUNT(*) AS count FROM users WHERE email = ${email}
  `;

  // Extract the count value from the first row of the result
  const count = result.rows[0].count;

  // Log the count value
  console.log(`Email count: ${count}`);

  // Determine and return the email uniqueness based on the count
  return count;
}

const CreateUser = userSchema.omit({ id: true });
const UpdateUser = userSchema.omit({ id: true });

export type StateUser = {
  errors?: {
    name?: string[];
    email?: string[];
    password?: string[];
  };
  message?: string | null;
};

export async function createUser(prevState: StateUser, formData: FormData) {
  console.log('Validation Fields...');
  const validatedFields = CreateUser.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password')
  });

  // If form validation fails, return errors early. Otherwise, continue.
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create User.',
    };
  }

  // Prepare data for insertion into the database
  console.log('Prepare data for insertion into the database');
  const { name, email, password } = validatedFields.data;

  try {
    console.log('Checking if email is unique...');
    const emailCount = await isEmailUnique(email);
    if (emailCount > 0) {
      throw new Error('Email already exists');
    }

    console.log('Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('Inserting new user into database...');
    const newUser = await sql`
      INSERT INTO users (name, email, password)
      VALUES (${name}, ${email}, ${hashedPassword})
      RETURNING id, name, email;
    `;

    console.log('User created successfully:', newUser.rows[0]);

  } catch (error) {
    console.error('Failed to create user:', error);
    throw new Error('Failed to create user.');
  }

  revalidatePath('/dashboard/users');
  redirect('/dashboard/users');
}

export async function updateUser(
  id: string,
  prevState: StateUser,
  formData: FormData,
) {
    const validatedFields = UpdateUser.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      password: formData.get('password'),
    });
  
    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: 'Missing Fields. Failed to Update Invoice.',
      };
    }
  
    const { name, email, password } = validatedFields.data;  
  try {
    

    const existingUser = await sql`SELECT * FROM users WHERE id = ${id}`;
    if (!existingUser.rows.length) {
      throw new Error('User not found');
    }

    if (email !== existingUser.rows[0].email && !(await isEmailUnique(email))) {
      throw new Error('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await sql`
      UPDATE users
      SET name = ${name}, email = ${email}, password = ${hashedPassword}
      WHERE id = ${id}
    `;
    
  } catch (error) {
    console.error('Failed to update user:', error);
    throw new Error('Failed to update user.');
  } finally {
    revalidatePath('/dashboard/users');
    redirect('/dashboard/users');
  }
}

export async function deleteUser(id: string) {
  try {
    await sql`DELETE FROM users WHERE id = ${id}`;
    revalidatePath('/dashboard/users');
    return { message: 'Deleted User.' };
  } catch (error) {
    console.error('Failed to delete user:', error);
    throw new Error('Failed to delete user.');
  }
}

// Invoice-related functions and schemas...
const FormSchema = z.object({
  id: z.string(),
  customerId: z.string({
    invalid_type_error: 'Please select a customer.',
  }),
  amount: z.coerce
    .number()
    .gt(0, { message: 'Please enter an amount greater than $0.' }),
  status: z.enum(['pending', 'paid'], {
    invalid_type_error: 'Please select an invoice status.',
  }),
  date: z.string(),
});

const CreateInvoice = FormSchema.omit({ id: true, date: true });
const UpdateInvoice = FormSchema.omit({ id: true, date: true });


export type State = {
  errors?: {
    customerId?: string[];
    amount?: string[];
    status?: string[];
  };
  message?: string | null;
};

export async function createInvoice(prevState: State, formData: FormData) {
  const validatedFields = CreateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });

  // If form validation fails, return errors early. Otherwise, continue.
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Invoice.',
    };
  }

  // Prepare data for insertion into the database
  const { customerId, amount, status } = validatedFields.data;

  // Store monetary values in cents in your database 
  // to eliminate JavaScript floating-point errors
  const amountInCents = amount * 100;
  // Create a new date with the format "YYYY-MM-DD" for the invoice's creation date
  const date = new Date().toISOString().split('T')[0];

  try {
    await sql`
      INSERT INTO invoices (customer_id, amount, status, date)
      VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
    `;
  } catch (error) {
    return {
      message: 'Database Error: Failed to Create Invoice.',
    };
  }

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function updateInvoice(
  id: string,
  prevState: State,
  formData: FormData,
) {
  const validatedFields = UpdateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Update Invoice.',
    };
  }

  const { customerId, amount, status } = validatedFields.data;
  const amountInCents = amount * 100;

  try {
    await sql`
      UPDATE invoices
      SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
      WHERE id = ${id}
    `;
  } catch (error) {
    return { message: 'Database Error: Failed to Update Invoice.' };
  }

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function deleteInvoice(id: string) {
  try {
    await sql`DELETE FROM invoices WHERE id = ${id}`;
    revalidatePath('/dashboard/invoices');
    return { message: 'Deleted Invoice.' };
  } catch (error) {
    return { message: 'Database Error: Failed to Delete Invoice.' };
  }
}

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}
