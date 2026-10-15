import { Anchor, Table, Text } from "@mantine/core";
import { IconExternalLink, IconFileText } from "@tabler/icons-react";
import type { PageRow } from "../../shared/pages";
import { BUILTIN, displayValue, readValues, type DatabaseConfig, type DatabaseView } from "../../shared/databases";
import { FieldInput, PropertyIcon } from "./fields";

type Props = {
  config: DatabaseConfig;
  view: DatabaseView;
  rows: PageRow[];
  readOnly: boolean;
  onStatus: (value: string) => void;
  onOpen: (id: string) => void;
};
export function DatabaseRows({ config, view, rows, readOnly, onStatus, onOpen }: Props) {
  const fields = [...BUILTIN, ...config.properties];
  return (
      <div className="database-scroll" id="database-view-panel" role="tabpanel" aria-labelledby={"database-view-" + view.id} data-testid="database-rows">
        {view.layout === "table" ? (
          <Table className="database-table" withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                {view.columns.map((id) => (
                  <Table.Th key={id}>
                    <span className="database-column-heading">
                      <PropertyIcon type={fields.find((p) => p.id === id)?.type ?? "text"} />
                      {fields.find((p) => p.id === id)?.name}
                    </span>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id} data-testid="database-row">
                  {view.columns.map((id) => (
                    <Table.Td key={id}>
                      {id === "title" ? (
                        <div className="database-title-cell">
                          <IconFileText className="database-row-icon" size={16} stroke={1.6} aria-hidden="true" />
                          <FieldInput
                            row={row}
                            property={{
                              id: "title",
                              name: "名稱",
                              type: "text",
                              options: [],
                            }}
                            status={onStatus}
                            disabled={readOnly}
                          />
                          <Anchor
                            className="database-open-row"
                            aria-label={"開啟 " + row.title}
                            title={"開啟 " + row.title}
                            href={"/?page=" + row.id}
                            onClick={(e) => {
                              e.preventDefault();
                              onOpen(row.id);
                            }}
                          >
                            <IconExternalLink size={14} aria-hidden="true" />
                            <span className="database-visually-hidden">開啟 {row.title}</span>
                          </Anchor>
                        </div>
                      ) : id === "created_at" || id === "updated_at" ? (
                        <Text size="xs">
                          {new Date(row[id]).toLocaleString("zh-TW", {
                            timeZone: "Asia/Taipei",
                          })}
                        </Text>
                      ) : (
                        <FieldInput
                          row={row}
                          property={config.properties.find((p) => p.id === id)!}
                          status={onStatus}
                          disabled={readOnly}
                        />
                      )}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <div className="database-list">
            {rows.map((row) => (
              <div className="database-list-row" key={row.id} data-testid="database-row">
                <Anchor
                  className="database-list-title"
                  href={"/?page=" + row.id}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen(row.id);
                  }}
                >
                  <IconFileText size={17} stroke={1.6} aria-hidden="true" />
                  <span>{row.title}</span>
                </Anchor>
                <div className="database-list-values">
                {view.columns
                  .filter((id) => id !== "title")
                  .map((id) => (
                    <Text key={id} size="sm" c="dimmed" title={fields.find((p) => p.id === id)?.name}>
                      {id === "created_at" || id === "updated_at"
                        ? new Date(row[id]).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })
                        : displayValue(
                            readValues(row.property_values)[id] ?? null,
                            config.properties.find((p) => p.id === id),
                          )}
                    </Text>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
  );
}
