"use client";

import { useEffect, useState, type FormEvent } from "react";
import { isReturnHomeOption, RETURN_HOME_OPTIONS, returnHomeLabel } from "@/lib/returnHome";
import { DEFAULT_WORK_SHIFT, isWorkShiftOption, workShiftLabel, WORK_SHIFT_OPTIONS } from "@/lib/workShift";
import type { Employee, EmployeeAccount, EmployeeRatesUpdate, NewEmployee, UserRole } from "@/lib/types";

const RATE_FIELDS: (keyof EmployeeRatesUpdate)[] = ["base_allowance", "base_ot_rate", "return_home_rate", "work_shift"];

function ratesOf(employee: Employee): EmployeeRatesUpdate {
  return {
    base_allowance: Number(employee.base_allowance),
    base_ot_rate: Number(employee.base_ot_rate),
    return_home_rate: Number(employee.return_home_rate),
    work_shift: employee.work_shift,
  };
}

const EMPTY_FORM: NewEmployee = {
  emp_code: "",
  name: "",
  base_allowance: 0,
  base_ot_rate: 0,
  return_home_rate: 0,
  work_shift: DEFAULT_WORK_SHIFT,
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NewEmployee>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, EmployeeRatesUpdate>>({});
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [updatedId, setUpdatedId] = useState<number | null>(null);
  const [accountBusyId, setAccountBusyId] = useState<number | null>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  async function loadEmployees() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/employees");
      if (!res.ok) throw new Error("Failed to load employees");
      const data: Employee[] = await res.json();
      setEmployees(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (!form.emp_code.trim() || !form.name.trim()) {
      setFormError("Employee code and name are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create employee");
      }

      setForm(EMPTY_FORM);
      await loadEmployees();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function editedRates(employee: Employee): EmployeeRatesUpdate {
    return edits[employee.id] ?? ratesOf(employee);
  }

  function isDirty(employee: Employee): boolean {
    const edited = edits[employee.id];
    if (!edited) return false;
    const original = ratesOf(employee);
    return RATE_FIELDS.some((f) => edited[f] !== original[f]);
  }

  function setRate(employee: Employee, field: keyof EmployeeRatesUpdate, value: number | string) {
    setUpdatedId(null);
    setEdits({ ...edits, [employee.id]: { ...editedRates(employee), [field]: value } });
  }

  async function handleUpdate(employee: Employee) {
    const rates = editedRates(employee);
    const numericFields = RATE_FIELDS.filter((f) => f !== "work_shift") as (keyof EmployeeRatesUpdate)[];
    if (numericFields.some((f) => !Number.isFinite(rates[f]) || (rates[f] as number) < 0)) {
      setError("Rates must be numbers of 0 or more.");
      return;
    }
    if (!isReturnHomeOption(rates.return_home_rate)) {
      setError(`${employee.emp_code}: please choose a Return Home option.`);
      return;
    }
    if (!isWorkShiftOption(rates.work_shift)) {
      setError(`${employee.emp_code}: please choose a Time In-Out option.`);
      return;
    }

    setUpdatingId(employee.id);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rates),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update employee");

      setEmployees(employees.map((e) => (e.id === employee.id ? { ...e, ...(data as Employee) } : e)));
      const rest = { ...edits };
      delete rest[employee.id];
      setEdits(rest);
      setUpdatedId(employee.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUpdatingId(null);
    }
  }

  function setAccount(employeeId: number, account: EmployeeAccount) {
    setEmployees((list) => list.map((e) => (e.id === employeeId ? { ...e, account } : e)));
  }

  async function handleResetLogin(employee: Employee) {
    setError(null);
    setAccountMessage(null);
    const send = (temp?: string) =>
      fetch(`/api/users/${employee.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(temp ? { temp_password: temp } : {}),
      });
    setAccountBusyId(employee.id);
    try {
      let res = await send();
      if (res.status === 422) {
        const temp = window.prompt(`${employee.emp_code} has no phone number in TimeMint. Enter a temporary password:`);
        if (!temp) return;
        res = await send(temp);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to reset login");
      setAccount(employee.id, data as EmployeeAccount);
      setAccountMessage(`${employee.emp_code}: login reset. Username "${(data as EmployeeAccount).username}", first password = phone number.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAccountBusyId(null);
    }
  }

  async function handleRoleChange(employee: Employee, role: UserRole) {
    setError(null);
    setAccountMessage(null);
    setAccountBusyId(employee.id);
    try {
      const res = await fetch(`/api/users/${employee.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to change role");
      setAccount(employee.id, data as EmployeeAccount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAccountBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete employee");
      }
      await loadEmployees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Employees</h1>
        <p className="mt-1 text-sm text-gray-500">Manage employee records and welfare rates.</p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Add Employee</h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Employee Code</label>
            <input
              type="text"
              value={form.emp_code}
              onChange={(e) => setForm({ ...form, emp_code: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              placeholder="EMP003"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              placeholder="Full name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Base Allowance</label>
            <input
              type="number"
              step="0.01"
              value={form.base_allowance}
              onChange={(e) => setForm({ ...form, base_allowance: Number(e.target.value) })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Base OT Rate</label>
            <input
              type="number"
              step="0.01"
              value={form.base_ot_rate}
              onChange={(e) => setForm({ ...form, base_ot_rate: Number(e.target.value) })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Return Home</label>
            <select
              value={form.return_home_rate}
              onChange={(e) => setForm({ ...form, return_home_rate: Number(e.target.value) })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {RETURN_HOME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Time In-Out</label>
            <select
              value={form.work_shift}
              onChange={(e) => setForm({ ...form, work_shift: e.target.value })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {WORK_SHIFT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {submitting ? "Adding..." : "Add Employee"}
            </button>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>
        </form>
      </section>

      {accountMessage && (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">{accountMessage}</p>
      )}
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Code</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Allowance</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">OT Rate</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Return Home</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Time In-Out</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Login</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                    Loading employees...
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-red-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && employees.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                    No employees yet.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{employee.emp_code}</td>
                    <td className="px-4 py-3 text-gray-700">{employee.name}</td>
                    {RATE_FIELDS.map((field) =>
                      field === "return_home_rate" ? (
                        <td key={field} className="px-4 py-2 text-right">
                          <select
                            value={editedRates(employee).return_home_rate}
                            onChange={(e) => setRate(employee, field, Number(e.target.value))}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                          >
                            {!isReturnHomeOption(editedRates(employee).return_home_rate) && (
                              <option value={editedRates(employee).return_home_rate} disabled>
                                {returnHomeLabel(editedRates(employee).return_home_rate)}
                              </option>
                            )}
                            {RETURN_HOME_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      ) : field === "work_shift" ? (
                        <td key={field} className="px-4 py-2 text-right">
                          <select
                            value={editedRates(employee).work_shift}
                            onChange={(e) => setRate(employee, field, e.target.value)}
                            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                          >
                            {!isWorkShiftOption(editedRates(employee).work_shift) && (
                              <option value={editedRates(employee).work_shift} disabled>
                                {workShiftLabel(editedRates(employee).work_shift)}
                              </option>
                            )}
                            {WORK_SHIFT_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      ) : (
                      <td key={field} className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editedRates(employee)[field] as number}
                          onChange={(e) => setRate(employee, field, Number(e.target.value))}
                          className="w-28 rounded-md border border-gray-300 px-2 py-1 text-right text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                        />
                      </td>
                      )
                    )}
                    <td className="px-4 py-2 whitespace-nowrap text-sm">
                      {employee.account ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-gray-800">{employee.account.username}</span>
                          <select
                            value={employee.account.role}
                            disabled={accountBusyId === employee.id}
                            onChange={(e) => handleRoleChange(employee, e.target.value as UserRole)}
                            className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                          {!employee.account.has_password && <span className="text-xs text-amber-700">no password</span>}
                          {employee.account.locked && <span className="text-xs text-red-600">locked</span>}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">no login yet</span>
                      )}
                      <button
                        onClick={() => handleResetLogin(employee)}
                        disabled={accountBusyId === employee.id}
                        className="mt-1 text-xs text-gray-600 underline disabled:opacity-50"
                      >
                        {employee.account ? "Reset password" : "Create login"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {updatedId === employee.id && <span className="mr-3 text-sm text-green-700">Saved</span>}
                      <button
                        onClick={() => handleUpdate(employee)}
                        disabled={!isDirty(employee) || updatingId === employee.id}
                        className="mr-4 rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                      >
                        {updatingId === employee.id ? "Updating..." : "Update"}
                      </button>
                      <button
                        onClick={() => handleDelete(employee.id)}
                        disabled={deletingId === employee.id}
                        className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                      >
                        {deletingId === employee.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
