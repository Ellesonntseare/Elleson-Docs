import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, PDFName, PDFString, PDFHexString, PDFArray } from "pdf-lib"
import { fieldValue, setFieldValue, validFieldValue, sameValue } from "./pdf-fields.mjs"

const typeKey = PDFName.of("EllesonFieldType")
const kind = field => field instanceof PDFTextField ? field.acroField.dict.get(typeKey)?.toString() === "/Date" ? "date" : "text" : field instanceof PDFCheckBox ? "checkbox" :
  field instanceof PDFDropdown ? "dropdown" : field instanceof PDFRadioGroup ? "radio" : field instanceof PDFOptionList ? "list" : "unsupported"

function widgets(doc, field) {
  const pages = doc.getPages()
  const refs = field.acroField.dict.lookupMaybe(PDFName.of("Kids"), PDFArray)?.asArray() || [field.ref]
  return field.acroField.getWidgets().map((widget, index) => {
    const page = pages.findIndex(page => page.ref === widget.P() || page.node.Annots()?.asArray().includes(refs[index]))
    return { page: page + 1, ...widget.getRectangle() }
  })
}

export async function inspectForm(bytes, answers = {}) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  return pdf.getForm().getFields().map(field => ({
    name: field.getName(), type: kind(field), required: field.isRequired(), readOnly: field.isReadOnly(),
    options: field.getOptions?.(),
    label: field.acroField.dict.lookupMaybe(PDFName.of("TU"), PDFString, PDFHexString)?.decodeText(),
    value: Object.hasOwn(answers, field.getName()) ? answers[field.getName()] : fieldValue(field),
    widgets: widgets(pdf, field)
  }))
}

function rectangle(pdf, definition) {
  const { page, x, y, width, height } = definition
  if (!Number.isInteger(page) || page < 1 || page > pdf.getPageCount() || ![x, y, width, height].every(Number.isFinite)) throw new Error("Choose a valid page and field position.")
  const target = pdf.getPage(page - 1)
  const box = target.getCropBox()
  if (width < 5 || height < 5 || x < box.x - .01 || y < box.y - .01 || x + width > box.x + box.width + .01 || y + height > box.y + box.height + .01) {
    throw new Error("Keep the field inside the page and at least 5 points wide and high.")
  }
  return target
}

export async function authorForm(bytes, changes, answers = {}) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error("Choose 1–100 field changes.")
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const form = pdf.getForm()
  for (const [name, value] of Object.entries(answers)) {
    const field = form.getFieldMaybe(name)
    if (field) setFieldValue(field, value)
  }
  for (const change of changes) {
    const { action, name, type, required, label } = change
    if (typeof name !== "string" || !name.trim() || name.length > 150) throw new Error("Enter a field name between 1 and 150 characters.")
    const field = form.getFieldMaybe(name)
    if (action === "delete") {
      if (!field || kind(field) === "unsupported") throw new Error("Choose an editable field to remove.")
      form.removeField(field)
      continue
    }
    if (action === "fill") {
      if (!field || field.isReadOnly() || !validFieldValue(change.value)) throw new Error("This field cannot be filled.")
      if (!sameValue(fieldValue(field), change.before)) throw Object.assign(new Error("A field changed. Refresh the autofill preview."), { status: 409 })
      setFieldValue(field, change.value)
      continue
    }
    let target
    if (action === "update") {
      const boxes = field && widgets(pdf, field)
      if (!field || kind(field) === "unsupported") throw new Error("Choose an editable field.")
      if (change.resize !== false) {
        if (boxes.length !== 1 || change.page !== boxes[0].page) throw new Error("Move or resize a single-widget field on its original page.")
        rectangle(pdf, change)
        field.acroField.getWidgets()[0].setRectangle({ x: change.x, y: change.y, width: change.width, height: change.height })
        form.markFieldAsDirty(field.ref)
      }
      target = field
      if (change.newName !== undefined && change.newName !== name) {
        if (typeof change.newName !== "string" || !change.newName.trim() || change.newName.length > 150 || change.newName.includes(".") || name.includes(".") || form.getFieldMaybe(change.newName)) throw new Error("Choose a unique name for a top-level field.")
        target.acroField.setPartialName(change.newName)
      }
    } else if (action === "create") {
      if (field || !["text", "date", "checkbox", "dropdown", "radio"].includes(type)) throw new Error("Choose a unique name and a supported field type.")
      const page = rectangle(pdf, change)
      const appearance = { x: change.x, y: change.y, width: change.width, height: change.height, borderWidth: 0 }
      const options = Array.isArray(change.options) ? [...new Set(change.options.filter(option => typeof option === "string" && option.trim() && option.length <= 80))] : []
      if (type === "radio") {
        if (options.length < 2 || options.length > 12) throw new Error("Enter 2–12 radio choices.")
        target = form.createRadioGroup(name)
        options.forEach((option, index) => {
          const y = change.y - index * (change.height + 5)
          rectangle(pdf, { ...change, y })
          target.addOptionToPage(option, page, { ...appearance, y })
        })
      } else {
        target = type === "checkbox" ? form.createCheckBox(name) : type === "dropdown" ? form.createDropdown(name) : form.createTextField(name)
        if (type === "dropdown") {
          if (!options.length || options.length > 50) throw new Error("Enter 1–50 dropdown choices.")
          target.setOptions(options)
        }
        if (type === "date") target.acroField.dict.set(typeKey, PDFName.of("Date"))
        target.addToPage(page, appearance)
      }
    } else throw new Error("Unknown form action.")
    if (required === true) target.enableRequired()
    if (required === false) target.disableRequired()
    if (typeof label === "string") {
      if (label.trim()) target.acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(label.trim().slice(0, 150)))
      else target.acroField.dict.delete(PDFName.of("TU"))
    }
  }
  return pdf.save()
}
