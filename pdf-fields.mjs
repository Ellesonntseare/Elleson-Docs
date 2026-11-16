import { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, PDFName, PDFArray } from 'pdf-lib'

export function fieldValue(field) {
  if (field instanceof PDFTextField) return field.getText() || ''
  if (field instanceof PDFCheckBox) return field.isChecked()
  if (field instanceof PDFRadioGroup) return field.getSelected() || ''
  if (field instanceof PDFOptionList || field instanceof PDFDropdown) {
    const values = field.getSelected()
    return field.isMultiselect() ? values : values[0] || ''
  }
  return ''
}
export const fieldValues = pdf => Object.fromEntries(pdf.getForm().getFields().map(field => [field.getName(), fieldValue(field)]))
export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const validFieldValue = value => typeof value === 'boolean' || typeof value === 'string' && value.length <= 2000 || Array.isArray(value) && value.length <= 200 && value.every(item => typeof item === 'string' && item.length <= 2000)

export function setFieldValue(field, value) {
  if (field instanceof PDFTextField && typeof value === 'string') field.setText(value)
  else if (field instanceof PDFCheckBox && typeof value === 'boolean') value ? field.check() : field.uncheck()
  else if (field instanceof PDFRadioGroup && typeof value === 'string') value ? field.select(value) : field.clear()
  else if ((field instanceof PDFDropdown || field instanceof PDFOptionList) && (typeof value === 'string' || Array.isArray(value))) {
    if (value === '' || Array.isArray(value) && !value.length) field.clear()
    else field.select(value)
  } else throw new Error('This PDF field does not support that value.')
}

export function flattenPdfForm(pdf){
  pdf.getForm().flatten()
  // pdf-lib can leave widget references in /Annots after removing their objects.
  // Remove only unresolved references; ordinary comments and links remain intact.
  for(const page of pdf.getPages()){
    const annotations=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray)
    if(!annotations)continue
    for(let i=annotations.size()-1;i>=0;i--)if(!pdf.context.lookup(annotations.get(i)))annotations.remove(i)
  }
}
